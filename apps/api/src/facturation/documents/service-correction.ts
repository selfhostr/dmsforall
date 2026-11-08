import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type {
  EntreeCorrectionFacture,
  ReponseAvecAvertissements,
  ReponseCorrectionFacture,
  ReponseDocumentVente,
} from '@dfa/shared';

/** Forme EXACTE inférée par `schemaCorrectionFacture` pour `champsCorriges.adresseFacturation`
 *  (`numero` y est `.nullish()` — `string | null | undefined` — contrairement à
 *  `AdresseStructureeQr.numero`, strictement `string | null` : les DEUX types existent dans le
 *  contrat pour des raisons différentes, ne pas les confondre). */
type OverlayAdresseFacturation = NonNullable<
  NonNullable<EntreeCorrectionFacture['champsCorriges']>['adresseFacturation']
>;

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../../db';
import {
  clientAdresse,
  documentVente,
  ligneDocument,
  reportReglementCorrection,
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
import { calculerStatutReglement } from '../paiements/imputations';

import { adapterLigneRecopieeAuRegimeActuel, chargerSituationTva } from './assujettissement';
import { calculerLigneDocument } from './calcul-document';
import { chargerDocumentPourEcriture, listerLignesDocumentPourEcriture } from './document-requetes';
import { calculerRetardDocument } from './echeance';
import { chargerIdAdresseFacturationActive } from './references';
import { ServiceAvoir } from './service-avoir';
// Import de CLASSE (jamais `import type`) : injection Nest, voir la note de `service-avoir.ts`.
import { ServiceDocumentsVente } from './service-documents';
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
 * reliée à l'originale par `remplace_id`, ni par `document_source_id` (MD-14, réservé à la chaîne
 * devis→bon_commande→facture — une correction relie deux FACTURES, pas une progression).
 *
 * Issue #156 : `document_vente.facture_corrigee_id` (migration 0063 §2), posé UNIQUEMENT sur la
 * facture de REMPLACEMENT, pointe vers l'ORIGINALE qu'elle corrige — traçabilité EN BASE, pas
 * seulement dans la réponse HTTP (`{avoir, factureRemplacement}`) ou via `avoir.factureAnnuleeId`
 * (qui pointe déjà vers l'originale mais ne dit rien de la facture de remplacement). Voir
 * `creerFactureRemplacementTx` ci-dessous et l'en-tête de `0063_report_reglement_correction.sql`
 * §2 pour le raisonnement complet (pourquoi une colonne dédiée plutôt que réutiliser les deux
 * existantes).
 */
@Injectable()
export class ServiceCorrectionFacture {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    private readonly horloge: Horloge,
    private readonly avoirs: ServiceAvoir,
    private readonly emission: ServiceEmissionDocument,
    private readonly documents: ServiceDocumentsVente,
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
        if (entree.mode === 'brouillon') {
          await this.verifierCorrigeableEnBrouillonTx(tx, ctx, facture);
        }
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

        // Mode `brouillon` : l'avoir est émis (la facture est annulée), mais la nouvelle facture
        // reste un BROUILLON pré-rempli — AUCUNE émission, AUCUN report de règlement (refusé en
        // amont si la facture portait un encaissement), AUCUN report sur la fiche client.
        if (entree.mode === 'brouillon') {
          const brouillonId = await this.creerFactureRemplacementTx(
            tx,
            ctx,
            facture,
            lignesFacture,
            undefined,
            maintenant,
          );
          const brouillon = await this.documents.assemblerDocument(
            tx,
            ctx,
            principal.role,
            brouillonId,
          );
          return {
            statutHttp: 201,
            corps: {
              donnees: { mode: 'brouillon', avoir, factureRemplacement: brouillon },
              avertissements: [],
            },
          };
        }

        // 3. Facture de remplacement — mêmes lignes (recopiées, AUCUN nouveau mouvement de stock :
        //    la marchandise n'est pas revendue, seule la paperasse change), en-tête recopié avec
        //    l'overlay `champsCorriges`.
        const nouvelleFactureId = await this.creerFactureRemplacementTx(
          tx,
          ctx,
          facture,
          lignesFacture,
          entree.champsCorriges,
          maintenant,
        );

        // 4. Émission immédiate de la facture de remplacement — MÊME chemin que toute émission
        //    (numéro, TVA, échéance, QR, verrouillage). Volontairement PAS de rappel à
        //    `marquerVehiculeVenduSiApplicable` (effet RV-37 de `emettre()`, hors `emettreCoeurTx`
        //    précisément pour cette raison) : le véhicule est déjà `vendu` depuis l'émission
        //    ORIGINALE, qu'une correction de désignation/adresse ne remet jamais en cause.
        const factureRemplacementEmise = await this.emission.emettreCoeurTx(
          tx,
          ctx,
          principal,
          nouvelleFactureId,
        );

        // 4bis. Issue #154 : le paiement suit la facture de remplacement. `facture` est le
        //    document chargé AVANT toute écriture (étape 0) — l'avoir/l'émission ne touchent
        //    jamais `montant_regle_centimes` (RF-32 ne porte que sur `statut`/`annule_par_avoir_id`),
        //    donc sa valeur reste celle du règlement réellement encaissé sur la facture d'origine.
        const factureRemplacement = await this.reporterReglementSiNecessaireTx(
          tx,
          ctx,
          facture,
          nouvelleFactureId,
          factureRemplacementEmise,
        );

        // 5. RF-14 : report DÉCOCHABLE sur la fiche client — seule `adresseFacturation` a une cible
        //    d'écriture sans ambiguïté (`client_adresse`, ligne facturation/principale). `clientDesignation`
        //    N'EST PAS reporté sur `client` (`nom`/`prenom` vs `raisonSociale` selon le type de
        //    client : aucune correspondance sûre depuis un texte libre) — SIGNALÉ au rapport de
        //    livraison plutôt qu'un mapping deviné.
        if (entree.corrigerFicheClient && entree.champsCorriges?.adresseFacturation) {
          await this.reporterAdresseSurFicheTx(
            tx,
            ctx,
            facture.clientId,
            entree.champsCorriges.adresseFacturation,
          );
        }

        return {
          statutHttp: 201,
          corps: {
            donnees: { mode: 'remplacement', avoir, factureRemplacement },
            avertissements: [],
          },
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
    champsCorriges: EntreeCorrectionFacture['champsCorriges'],
    maintenant: Date,
  ): Promise<string> {
    const clientDesignationFigee =
      champsCorriges?.clientDesignation ?? facture.clientDesignationFigee;
    const adresseFacturationFigee =
      champsCorriges?.adresseFacturation ?? facture.adresseFacturationFigee;

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
        // Issue #156 : traçabilité EN BASE de la facture corrigée — voir la docstring de tête de
        // ce fichier (pourquoi ni `documentSourceId` ni `remplaceId` ne conviennent) et l'en-tête
        // de `0063_report_reglement_correction.sql` §2 pour le raisonnement complet.
        factureCorrigeeId: facture.id,
      })
      .returning();
    if (!nouvelle)
      throw new ErreurMetier(
        'ERREUR_INTERNE',
        "L'insertion de la facture de remplacement n'a rendu aucune ligne.",
      );

    // Régime ACTUEL du garage (`adapterLigneRecopieeAuRegimeActuel`, qui s'appuie sur
    // `normaliserTauxEtRegime`) : un garage devenu non assujetti depuis l'émission d'origine
    // recopie ses lignes à 0 ‰ / `exclu` (prix TTC conservé, donc HT = TTC) ; sinon une
    // facture de remplacement à TVA > 0 serait refusée à l'émission. Assujetti : recopie telle quelle.
    const situationTva = await chargerSituationTva(tx, ctx);
    let numeroOrdre = 1;
    for (const ligne of lignesFacture) {
      const regime = adapterLigneRecopieeAuRegimeActuel(situationTva, ligne);
      const regimeTva = regime.regimeTva;
      const tauxTvaPourmille = regime.tauxTvaPourmille ?? 0;
      const montants = calculerLigneDocument({
        prixUnitaireTtcCentimes: ligne.prixUnitaireCentimes,
        quantiteMillieme: ligne.quantiteMillieme,
        remisePourmille: ligne.remisePourmille,
        remiseMontantCentimes: ligne.remiseMontantCentimes,
        remiseGlobaleRepartieCentimes: 0,
        tauxTvaPourmille,
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
          regimeTva,
          tauxTvaPourmille,
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

  /**
   * Mode `brouillon` : refus clairs AVANT toute écriture (la transaction n'a encore rien changé).
   * - déjà annulée par un avoir (donc déjà corrigée ou créditée) → `FACTURE_DEJA_CORRIGEE`, avec
   *   le document de correction en `blocages[]` s'il existe (brouillon ou facture de remplacement) ;
   * - un règlement est déjà imputé (partiel ou total) → `FACTURE_CORRECTION_REGLEMENT_EXISTANT` :
   *   le brouillon étant libre de changer le montant, le report automatique du paiement
   *   (mode `remplacement`) n'a plus de sens, et l'avoir total d'une facture payée créerait un
   *   trop-perçu. Le garagiste doit d'abord défaire le règlement.
   * Les autres statuts (brouillon, annulée…) restent refusés par `validerFactureCreditable`.
   */
  private async verifierCorrigeableEnBrouillonTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    facture: LigneDocumentVente,
  ): Promise<void> {
    if (facture.statut === 'annule_par_avoir') {
      const [correction] = await tx
        .select({ id: documentVente.id, numero: documentVente.numero })
        .from(documentVente)
        .where(
          and(
            eq(documentVente.tenantId, ctx.tenantId),
            eq(documentVente.factureCorrigeeId, facture.id),
          ),
        )
        .limit(1);
      const cible = correction ?? { id: facture.id, numero: facture.numero };
      throw new ErreurMetier(
        'FACTURE_DEJA_CORRIGEE',
        `La facture ${facture.numero ?? facture.id} a déjà été annulée par un avoir.`,
        {
          blocages: [
            {
              type: 'document_vente',
              id: cible.id,
              libelle: cible.numero ?? cible.id,
              donnees: { statutActuel: facture.statut },
            },
          ],
        },
      );
    }
    if (facture.statut === 'emis' && facture.montantRegleCentimes > 0n) {
      throw new ErreurMetier(
        'FACTURE_CORRECTION_REGLEMENT_EXISTANT',
        `La facture ${facture.numero ?? facture.id} porte déjà un règlement de ` +
          `${facture.montantRegleCentimes} centimes.`,
        {
          blocages: [
            {
              type: 'document_vente',
              id: facture.id,
              libelle: facture.numero ?? facture.id,
              donnees: { montantRegleCentimes: Number(facture.montantRegleCentimes) },
            },
          ],
        },
      );
    }
  }

  /**
   * Issue #154 — choix produit : « le paiement suit la facture de remplacement ». `facture`
   * (chargée à l'étape 0, AVANT toute écriture) porte encore `montant_regle_centimes` tel qu'il
   * était sur la facture d'origine — l'avoir/l'émission ne le touchent jamais (RF-32 ne porte que
   * sur `statut`/`annule_par_avoir_id`). Ne fait RIEN si aucun règlement n'était encaissé
   * (`montantRegleCentimes <= 0n`) : la facture de remplacement garde alors ses compteurs à zéro,
   * exactement ceux posés par `emettreCoeurTx` — pas de ligne `report_reglement_correction`
   * inutile.
   *
   * NE TOUCHE JAMAIS `imputation_paiement` (immuable, MD-51/MD-52 — voir l'en-tête de
   * `0063_report_reglement_correction.sql` pour le détail des trois pistes écartées) : le report
   * est un événement séparé, tracé dans `report_reglement_correction`, qui ne fait bouger que les
   * compteurs DÉRIVÉS du document (`montant_regle_centimes`/`solde_centimes`/`statut_reglement`,
   * MD-53) — même famille d'écriture que `recalculerDocumentApresImputation`
   * (`paiements/imputations.ts`), en dehors du lettrage.
   *
   * Recharge la facture de remplacement DEPUIS LA BASE (`chargerDocumentPourEcriture`, `FOR
   * UPDATE`) plutôt que de faire confiance à `totalTtcCentimes` de `factureRemplacementEmise` :
   * ce dernier est un DTO filtré par rôle (`ReponseDocumentVente.totalTtcCentimes` est absent pour
   * un rôle sans droit aux montants, `mappeurs.ts::roleVoitLesMontants`) — l'exactitude de
   * l'écriture financière ne peut jamais dépendre de ce que l'appelant a le droit de VOIR.
   */
  private async reporterReglementSiNecessaireTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    facture: LigneDocumentVente,
    nouvelleFactureId: string,
    factureRemplacementEmise: ReponseDocumentVente,
  ): Promise<ReponseDocumentVente> {
    const montantRegleOrigine = facture.montantRegleCentimes;
    if (montantRegleOrigine <= 0n) return factureRemplacementEmise;

    const nouvelle = await chargerDocumentPourEcriture(tx, ctx, nouvelleFactureId);
    const totalNouvelleFacture =
      nouvelle.totalTtcCentimes < 0n ? -nouvelle.totalTtcCentimes : nouvelle.totalTtcCentimes;

    // Défensif : GARANTI égal aujourd'hui — `schemaCorrectionFacture` (`@dfa/shared`) ne permet de
    // corriger que `clientDesignation`/`adresseFacturation`, jamais les lignes, et
    // `creerFactureRemplacementTx` ci-dessus recopie TOUJOURS les mêmes lignes que l'origine à
    // l'identique. Clampé quand même : si le contrat évoluait un jour pour permettre de corriger
    // des lignes, le report ne doit JAMAIS excéder ce qui est réellement dû sur la nouvelle
    // facture (MD-51.a) — un report qui romprait cet invariant est un bug de conception à
    // corriger, pas une valeur à faire disparaître en silence.
    const montantAReporter =
      montantRegleOrigine <= totalNouvelleFacture ? montantRegleOrigine : totalNouvelleFacture;

    const [report] = await tx
      .insert(reportReglementCorrection)
      .values({
        tenantId: ctx.tenantId,
        factureOrigineId: facture.id,
        factureRemplacementId: nouvelleFactureId,
        montantCentimes: montantAReporter,
        creeParId: ctx.utilisateurId,
      })
      .returning();
    if (!report)
      throw new ErreurMetier(
        'ERREUR_INTERNE',
        "L'insertion du report de règlement n'a rendu aucune ligne.",
      );

    // Facture ANNULÉE : sa dette réelle est nulle (même doctrine que
    // `paiements/imputations.ts::verifierDocumentImputable`) — le règlement ne lui appartient
    // plus après le report, ses compteurs reviennent donc à zéro. Rien n'est perdu : le trigger
    // générique `auditer_atelier('document_vente')` (0010 §7, inchangé) capture la ligne ENTIÈRE
    // avant/après sur cet UPDATE, et la ligne `report_reglement_correction` ci-dessus dit
    // explicitement où le montant est parti.
    await tx
      .update(documentVente)
      .set({ montantRegleCentimes: 0n, soldeCentimes: 0n, statutReglement: 'non_regle' })
      .where(and(eq(documentVente.tenantId, ctx.tenantId), eq(documentVente.id, facture.id)));

    // Facture de REMPLACEMENT : reçoit le montant reporté. Même formule que
    // `recalculerDocumentApresImputation` (`paiements/imputations.ts`) — soldeCentimes jamais
    // négatif (RF-67), statutReglement dérivé par la MÊME fonction qu'un lettrage ordinaire.
    const nouveauSolde = totalNouvelleFacture - montantAReporter;
    const soldeCentimesFinal = nouveauSolde > 0n ? nouveauSolde : 0n;
    const statutReglementFinal = calculerStatutReglement(montantAReporter, totalNouvelleFacture);

    await tx
      .update(documentVente)
      .set({
        montantRegleCentimes: montantAReporter,
        soldeCentimes: soldeCentimesFinal,
        statutReglement: statutReglementFinal,
      })
      .where(
        and(eq(documentVente.tenantId, ctx.tenantId), eq(documentVente.id, nouvelleFactureId)),
      );

    // Réponse HTTP : patchée SEULEMENT si le rôle voit les montants (même garde que
    // `mappeurs.ts::mapperDocument` — la clé est simplement ABSENTE du DTO sinon, jamais
    // `undefined` en valeur). `enRetard`/`joursRetard` recalculés avec le NOUVEAU solde plutôt que
    // recopiés : `calculerRetardDocument` est la seule porte de cette règle (MD-94), pas une
    // deuxième copie de sa logique ici.
    if (!('montantRegleCentimes' in factureRemplacementEmise)) return factureRemplacementEmise;

    const retard = calculerRetardDocument({
      statut: factureRemplacementEmise.statut,
      dateEcheance: factureRemplacementEmise.dateEcheance ?? null,
      soldeCentimes: Number(soldeCentimesFinal),
      maintenant: this.horloge.maintenant(),
    });

    return {
      ...factureRemplacementEmise,
      statutReglement: statutReglementFinal,
      montantRegleCentimes: Number(montantAReporter),
      soldeCentimes: Number(soldeCentimesFinal),
      ...retard,
    };
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
