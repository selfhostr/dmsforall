import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type {
  EntreeCorrectionFacture,
  ReponseAvecAvertissements,
  ReponseCorrectionFacture,
} from '@dfa/shared';

/** Forme EXACTE inférée par `schemaCorrectionFacture` pour `champsCorriges.adresseFacturation`
 *  (`numero` y est `.nullish()` — `string | null | undefined` — contrairement à
 *  `AdresseStructureeQr.numero`, strictement `string | null` : les DEUX types existent dans le
 *  contrat pour des raisons différentes, ne pas les confondre). */
type OverlayAdresseFacturation = NonNullable<
  EntreeCorrectionFacture['champsCorriges']['adresseFacturation']
>;

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../../db';
import {
  clientAdresse,
  documentVente,
  ligneDocument,
  type LigneDocumentVente,
  type LigneLigneDocument,
} from '../../db/schema';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import { ErreurMetier } from '../../common/erreurs/erreur-metier';
import { Horloge } from '../../common/horloge/horloge';
import {
  JETON_IDEMPOTENCE,
  type ReponseMemorisable,
  type ResultatIdempotent,
  type ServiceIdempotence,
} from '../../common/idempotence';

import { calculerLigneDocument } from './calcul-document';
import { chargerDocumentPourEcriture, listerLignesDocumentPourEcriture } from './document-requetes';
import { chargerIdAdresseFacturationActive } from './references';
import { ServiceAvoir } from './service-avoir';
import { ServiceEmissionDocument } from './service-emission';

/**
 * `POST /documents-vente/{factureId}/corriger` (`RF-12`→`RF-14`) — LE GESTE UNIQUE décrit par
 * `schemaCorrectionFacture`/`ReponseCorrectionFacture` (`@dfa/shared`) : une facture ÉMISE est
 * verrouillée (`MD-20`), elle ne se modifie JAMAIS — la corriger, c'est l'annuler par un avoir TOTAL
 * puis en émettre une nouvelle qui reprend le même contenu commercial avec l'en-tête corrigé. TROIS
 * documents immuables au final, exactement comme un avoir puis une facture créés séparément à la
 * main (voir la docstring du contrat) — cette classe n'invente AUCUN mécanisme parallèle à la
 * chaîne documentaire, elle orchestre `ServiceAvoir`/`ServiceEmissionDocument` DANS UNE SEULE
 * transaction SQL.
 *
 * Vérifié explicitement contre `transition_document_autorisee` (migration 0010 §7.3) avant
 * d'écrire cette classe : la SEULE sortie autorisée d'une facture `emis` est
 * `('facture','emis','annule_par_avoir', false)`, jamais un statut `remplace` — cette colonne/statut
 * (`document_vente.remplace_id`) est réservée aux DEVIS (`RF-8`, une seule occurrence dans la table
 * de transitions : `('devis','emis','remplace', false)`). La facture de remplacement n'est donc PAS
 * reliée à l'originale par `remplace_id` — l'association vit uniquement dans la réponse HTTP
 * (`{avoir, factureRemplacement}`) et, transitivement, via `avoir.factureAnnuleeId`.
 */
@Injectable()
export class ServiceCorrectionFacture {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    private readonly horloge: Horloge,
    private readonly avoirs: ServiceAvoir,
    private readonly emission: ServiceEmissionDocument,
  ) {}

  async corriger(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    factureId: string,
    entree: EntreeCorrectionFacture,
    cleIdempotence: string,
  ): Promise<
    ResultatIdempotent<
      ReponseMemorisable & { corps: ReponseAvecAvertissements<ReponseCorrectionFacture> }
    >
  > {
    return this.idempotence.executer(
      ctx,
      {
        methode: 'POST',
        chemin: '/documents-vente/:factureId/corriger',
        cle: cleIdempotence,
        corps: { factureId, ...entree },
      },
      async (tx) => {
        // Même contrôle d'applicabilité qu'un avoir (`ServiceAvoir.validerFactureCreditable`) : le
        // « geste engageant » de corriger n'agit que sur une facture ÉMISE. Une deuxième tentative
        // de correction sur la MÊME facture échoue ici naturellement — l'émission de l'avoir
        // (étape 2 ci-dessous) bascule déjà la facture à `annule_par_avoir` dès la première
        // correction, aucun compteur/verrou dédié n'est nécessaire.
        const facture = await chargerDocumentPourEcriture(tx, ctx, factureId);
        this.avoirs.validerFactureCreditable(facture);

        // `FOR UPDATE` : les lignes servent à la fois à créditer l'avoir et à peupler la facture de
        // remplacement — un état stable est requis pour les deux (même doctrine que l'émission).
        const lignesFacture = await listerLignesDocumentPourEcriture(tx, ctx, factureId);
        const maintenant = this.horloge.maintenant();

        // 1. Avoir TOTAL, sans retour physique de stock (voir la docstring de
        //    `construireAvoirTotalPourCorrectionTx` : rien n'est jamais rendu par le client ici).
        const { avoirId } = await this.avoirs.construireAvoirTotalPourCorrectionTx(
          tx,
          ctx,
          principal,
          factureId,
          facture,
          lignesFacture,
          entree.motif,
          entree.motifAutre ?? null,
          maintenant,
        );

        // 2. Émission IMMÉDIATE de l'avoir, dans la MÊME transaction — bascule la facture d'origine
        //    à `annule_par_avoir` (ServiceEmissionDocument.emettreCoeurTx, étape 6 de son corps).
        //    Condition nécessaire à l'étape 3 : `ligne_document_verifier_unicite_or` (MD-15,
        //    migration 0010) exclut les documents `annule_par_avoir` de son contrôle d'unicité —
        //    copier `ligneOrId` AVANT ce basculement violerait la contrainte.
        const avoir = await this.emission.emettreCoeurTx(tx, ctx, principal, avoirId);

        // 3. Facture de remplacement — mêmes lignes (recopiées, AUCUN nouveau mouvement de stock :
        //    la marchandise n'est pas revendue, seule la paperasse change), en-tête recopié avec
        //    l'overlay `champsCorriges`.
        const nouvelleFactureId = await this.creerFactureRemplacementTx(
          tx,
          ctx,
          facture,
          lignesFacture,
          entree,
          maintenant,
        );

        // 4. Émission immédiate de la facture de remplacement — MÊME chemin que toute émission
        //    (numéro, TVA, échéance, QR, verrouillage). Volontairement PAS de rappel à
        //    `marquerVehiculeVenduSiApplicable` (effet RV-37 de `emettre()`, hors `emettreCoeurTx`
        //    précisément pour cette raison) : le véhicule est déjà `vendu` depuis l'émission
        //    ORIGINALE, qu'une correction de désignation/adresse ne remet jamais en cause.
        const factureRemplacement = await this.emission.emettreCoeurTx(
          tx,
          ctx,
          principal,
          nouvelleFactureId,
        );

        // 5. RF-14 : report DÉCOCHABLE sur la fiche client — seule `adresseFacturation` a une cible
        //    d'écriture sans ambiguïté (`client_adresse`, ligne facturation/principale). `clientDesignation`
        //    N'EST PAS reporté sur `client` (`nom`/`prenom` vs `raisonSociale` selon le type de
        //    client : aucune correspondance sûre depuis un texte libre) — SIGNALÉ au rapport de
        //    livraison plutôt qu'un mapping deviné.
        if (entree.corrigerFicheClient && entree.champsCorriges.adresseFacturation) {
          await this.reporterAdresseSurFicheTx(
            tx,
            ctx,
            facture.clientId,
            entree.champsCorriges.adresseFacturation,
          );
        }

        return {
          statutHttp: 201,
          corps: { donnees: { avoir, factureRemplacement }, avertissements: [] },
        };
      },
    );
  }

  /**
   * Recopie l'en-tête et les lignes de `facture` sur un nouveau document `facture` (brouillon,
   * émis juste après par l'appelant). Recopie DIRECTE en base (`tx.insert`), jamais via
   * `ServiceDocumentsVente.inserterLigne` : cette dernière déclenche `RP-43`
   * (`sortieComptoirPourLigneTx`) dès que `articleId`/`siteId` sont fournis — un mouvement de stock
   * que la correction ne doit JAMAIS rejouer (la pièce a déjà été vendue une fois, à l'émission
   * ORIGINALE ; la corriger ne la revend pas une deuxième fois).
   */
  private async creerFactureRemplacementTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    facture: LigneDocumentVente,
    lignesFacture: readonly LigneLigneDocument[],
    entree: EntreeCorrectionFacture,
    maintenant: Date,
  ): Promise<string> {
    const clientDesignationFigee =
      entree.champsCorriges.clientDesignation ?? facture.clientDesignationFigee;
    const adresseFacturationFigee =
      entree.champsCorriges.adresseFacturation ?? facture.adresseFacturationFigee;

    const [nouvelle] = await tx
      .insert(documentVente)
      .values({
        tenantId: ctx.tenantId,
        siteId: facture.siteId,
        typeDocument: 'facture',
        natureFacture: facture.natureFacture,
        clientId: facture.clientId,
        vehiculeId: facture.vehiculeId,
        ordreReparationId: facture.ordreReparationId,
        dossierVenteId: facture.dossierVenteId,
        clientDesignationFigee,
        clientIdeFige: facture.clientIdeFige,
        langueFigee: facture.langueFigee,
        adresseFacturationFigee,
        conditionsPaiementFigees: facture.conditionsPaiementFigees,
        dateDocument: maintenant.toISOString().slice(0, 10),
        devise: facture.devise,
        remiseGlobaleSaisieCentimes: facture.remiseGlobaleSaisieCentimes,
        remiseGlobalePourmille: facture.remiseGlobalePourmille,
      })
      .returning();
    if (!nouvelle)
      throw new ErreurMetier(
        'ERREUR_INTERNE',
        "L'insertion de la facture de remplacement n'a rendu aucune ligne.",
      );

    let numeroOrdre = 1;
    for (const ligne of lignesFacture) {
      const montants = calculerLigneDocument({
        prixUnitaireTtcCentimes: ligne.prixUnitaireCentimes,
        quantiteMillieme: ligne.quantiteMillieme,
        remisePourmille: ligne.remisePourmille,
        remiseMontantCentimes: ligne.remiseMontantCentimes,
        remiseGlobaleRepartieCentimes: 0,
        tauxTvaPourmille: ligne.tauxTvaPourmille,
      });
      const [ligneInseree] = await tx
        .insert(ligneDocument)
        .values({
          tenantId: ctx.tenantId,
          documentId: nouvelle.id,
          numeroOrdre: numeroOrdre++,
          typeLigne: ligne.typeLigne,
          designation: ligne.designation,
          referenceTexte: ligne.referenceTexte,
          ligneOrId: ligne.ligneOrId,
          documentAcompteId: ligne.documentAcompteId,
          categorieComptable: ligne.categorieComptable,
          modeCalculTva: 'ttc',
          regimeTva: ligne.regimeTva,
          tauxTvaPourmille: ligne.tauxTvaPourmille,
          datePrestation: ligne.datePrestation,
          quantiteMillieme: ligne.quantiteMillieme,
          prixUnitaireCentimes: ligne.prixUnitaireCentimes,
          remisePourmille: ligne.remisePourmille,
          remiseMontantCentimes: ligne.remiseMontantCentimes,
          remiseGlobaleRepartieCentimes: 0,
          baseCentimes: montants.baseCentimes,
          htCentimes: montants.htCentimes,
          tvaCentimes: montants.tvaCentimes,
          ttcCentimes: montants.ttcCentimes,
          montantValoriseCentimes: ligne.montantValoriseCentimes,
        })
        .returning();
      if (!ligneInseree)
        throw new ErreurMetier(
          'ERREUR_INTERNE',
          "L'insertion d'une ligne de la facture de remplacement n'a rendu aucune ligne.",
        );
      // AUCUN appel à `ServiceMouvement` ici — voir la docstring de tête de cette méthode.
    }

    return nouvelle.id;
  }

  /** RF-14 : écrase l'adresse `facturation`/`principale` active du client avec l'overlay soumis —
   *  ne fait RIEN si le client n'a encore aucune adresse `facturation`/`principale` (n'invente pas
   *  de ligne, voir `chargerIdAdresseFacturationActive`). */
  private async reporterAdresseSurFicheTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    clientId: string,
    adresse: OverlayAdresseFacturation,
  ): Promise<void> {
    const adresseId = await chargerIdAdresseFacturationActive(tx, ctx, clientId);
    if (!adresseId) return;

    await tx
      .update(clientAdresse)
      .set({
        rue: adresse.rue,
        numero: adresse.numero ?? null,
        npa: adresse.npa,
        localite: adresse.localite,
        pays: adresse.pays,
      })
      .where(and(eq(clientAdresse.tenantId, ctx.tenantId), eq(clientAdresse.id, adresseId)));
  }
}
