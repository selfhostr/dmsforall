import { Inject, Injectable } from '@nestjs/common';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../../db';
import {
  documentVente,
  ligneDocument,
  type LigneDocumentVente,
  type LigneLigneDocument,
} from '../../db/schema';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import { CollecteurAvertissements } from '../../common/avertissements';
import { ErreurMetier } from '../../common/erreurs/erreur-metier';
import { Horloge } from '../../common/horloge/horloge';
import {
  JETON_IDEMPOTENCE,
  type ReponseMemorisable,
  type ResultatIdempotent,
  type ServiceIdempotence,
} from '../../common/idempotence';
// Import de CLASSE (jamais `import type`) : voir la note de `service-documents.ts` — même pont
// RP-46, symétrique de RP-43.
import { ServiceMouvement } from '../../pieces/service-mouvement';

import type {
  EntreeCreationAvoir,
  ReponseAvecAvertissements,
  ReponseDocumentVente,
} from '@dfa/shared';

import { calculerLigneDocument } from './calcul-document';
import { chargerDocumentPourEcriture, listerLignesDocument } from './document-requetes';
import { ServiceDocumentsVente } from './service-documents';

/**
 * Création d'un avoir depuis une facture (`RF-11` → `RF-18`, `MD-23`). Un avoir naît en
 * BROUILLON (`RF-9`) — il est émis séparément via `POST /documents-vente/{id}/emettre`
 * (`ServiceEmissionDocument.emettre`), comme tout document ; c'est À L'ÉMISSION que la facture
 * créditée bascule `annule_par_avoir` pour un avoir `portee = 'total'` (voir
 * `service-emission.ts` §6) — jamais à la création d'un brouillon qui pourrait encore être
 * abandonné.
 *
 * SIMPLIFICATION SIGNALÉE (à faire remonter à expert-facturation/expert-database) : `MD-23` exige
 * `Σ avoirs ≤ facture, PAR TAUX` — un plafond CUMULATIF sur tous les avoirs déjà émis pour une
 * même ligne. Aucune colonne de `ligne_document` ne relie une ligne d'avoir à la ligne de facture
 * qu'elle crédite (`ligne_or_id` sert l'OR, `document_acompte_id` sert l'acompte — rien
 * d'équivalent pour « ligne créditée »). Le plafond appliqué ICI est donc SIMPLE et NON CUMULATIF :
 * `montantTtcCentimes` demandé ≤ montant TTC ORIGINAL de la ligne de facture, ligne par ligne. Un
 * deuxième avoir partiel sur la même ligne n'est PAS empêché de dépasser le solde réellement
 * restant après le premier. Corriger cela proprement demande une colonne de traçabilité
 * (`ligne_document.ligne_creditee_id` ou équivalent), hors du périmètre d'écriture de cette tâche.
 */
@Injectable()
export class ServiceAvoir {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    private readonly horloge: Horloge,
    private readonly documents: ServiceDocumentsVente,
    private readonly serviceMouvement: ServiceMouvement,
  ) {}

  async creer(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    factureId: string,
    entree: EntreeCreationAvoir,
    cleIdempotence: string,
  ): Promise<
    ResultatIdempotent<
      ReponseMemorisable & { corps: ReponseAvecAvertissements<ReponseDocumentVente> }
    >
  > {
    return this.idempotence.executer(
      ctx,
      {
        methode: 'POST',
        chemin: '/documents-vente/:factureId/avoirs',
        cle: cleIdempotence,
        corps: { factureId, ...entree },
      },
      async (tx) => {
        const facture = await chargerDocumentPourEcriture(tx, ctx, factureId);
        this.validerFactureCreditable(facture);

        const lignesFacture = await listerLignesDocument(tx, ctx, factureId);
        const lignesACrediter = this.resoudreLignesACrediter(facture, lignesFacture, entree);

        const maintenant = this.horloge.maintenant();
        const [avoir] = await tx
          .insert(documentVente)
          .values({
            tenantId: ctx.tenantId,
            siteId: facture.siteId,
            typeDocument: 'avoir',
            clientId: facture.clientId,
            vehiculeId: facture.vehiculeId,
            ordreReparationId: facture.ordreReparationId,
            factureAnnuleeId: factureId,
            porteeAvoir: entree.portee,
            motifAvoir: entree.motif,
            motifAvoirLibre: entree.motifAutre ?? null,
            clientDesignationFigee: facture.clientDesignationFigee,
            clientIdeFige: facture.clientIdeFige,
            langueFigee: facture.langueFigee,
            adresseFacturationFigee: facture.adresseFacturationFigee,
            conditionsPaiementFigees: facture.conditionsPaiementFigees,
            dateDocument: maintenant.toISOString().slice(0, 10),
            devise: facture.devise,
          })
          .returning();
        if (!avoir)
          throw new ErreurMetier(
            'ERREUR_INTERNE',
            "L'insertion de l'avoir n'a rendu aucune ligne.",
          );

        const collecteur = new CollecteurAvertissements();
        let numeroOrdre = 1;
        for (const source of lignesACrediter) {
          const montants = calculerLigneDocument({
            prixUnitaireTtcCentimes: -source.montantCentimes,
            quantiteMillieme: 1000,
            remisePourmille: null,
            remiseMontantCentimes: null,
            remiseGlobaleRepartieCentimes: 0,
            tauxTvaPourmille: source.ligne.tauxTvaPourmille,
          });
          const [ligneAvoir] = await tx
            .insert(ligneDocument)
            .values({
              tenantId: ctx.tenantId,
              documentId: avoir.id,
              numeroOrdre: numeroOrdre++,
              typeLigne: source.ligne.typeLigne,
              designation: source.ligne.designation,
              referenceTexte: source.ligne.referenceTexte,
              modeCalculTva: 'ttc',
              regimeTva: source.ligne.regimeTva,
              tauxTvaPourmille: source.ligne.tauxTvaPourmille,
              datePrestation: source.ligne.datePrestation,
              quantiteMillieme: 1000,
              prixUnitaireCentimes: -source.montantCentimes,
              remiseGlobaleRepartieCentimes: 0,
              baseCentimes: montants.baseCentimes,
              htCentimes: montants.htCentimes,
              tvaCentimes: montants.tvaCentimes,
              ttcCentimes: montants.ttcCentimes,
            })
            .returning();
          if (!ligneAvoir)
            throw new ErreurMetier(
              'ERREUR_INTERNE',
              "L'insertion d'une ligne d'avoir n'a rendu aucune ligne.",
            );

          await this.retournerStockSiApplicable(
            tx,
            ctx,
            principal,
            facture.numero ?? factureId,
            source,
            ligneAvoir,
            collecteur,
          );
        }

        const document = await this.documents.assemblerDocument(tx, ctx, principal.role, avoir.id);
        return {
          statutHttp: 201,
          corps: { donnees: document, avertissements: collecteur.liste() },
        };
      },
    );
  }

  /**
   * RP-46 — LE PONT symétrique de RP-43 (`ServiceDocumentsVente.inserterLigne`) : quand la ligne de
   * FACTURE créditée (`source.ligne`) avait elle-même déclenché un mouvement `sortie_comptoir`
   * (retrouvé via `document_vente_ligne_id`, seule trace encore vivante de `articleId`/`siteId` —
   * voir la note d'intégration de `contrats/pieces/mouvement.ts`), un mouvement `retour_client`
   * symétrique est créé DANS CETTE MÊME TRANSACTION, référençant la ligne de l'AVOIR qui vient
   * d'être insérée (`ligneAvoir.id`).
   *
   * UNIQUEMENT quand le crédit est INTÉGRAL (`source.montantCentimes === source.ligne.ttcCentimes`)
   * — un crédit partiel (correction de prix, geste commercial) n'a pas de traduction fiable en
   * quantité physique réellement rendue par le client : DÉCISION DE CONTRAT (voir la note
   * d'intégration citée ci-dessus), avertissement `AVOIR_RETOUR_STOCK_NON_DECLENCHE` à la place —
   * jamais bloquant, l'avoir financier reste émis quoi qu'il arrive à ce geste stock.
   */
  private async retournerStockSiApplicable(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    factureLibelle: string,
    source: { readonly ligne: LigneLigneDocument; readonly montantCentimes: number },
    ligneAvoir: LigneLigneDocument,
    collecteur: CollecteurAvertissements,
  ): Promise<void> {
    const mouvementOrigine = await this.serviceMouvement.trouverMouvementParLigneDocumentTx(
      tx,
      ctx,
      source.ligne.id,
    );
    if (!mouvementOrigine || mouvementOrigine.type !== 'sortie_comptoir') return;

    if (source.montantCentimes !== source.ligne.ttcCentimes) {
      collecteur.ajouter(
        'AVOIR_RETOUR_STOCK_NON_DECLENCHE',
        `La ligne créditée (${source.ligne.designation}) a déclenché une sortie de stock à la vente, mais ce crédit est PARTIEL (${String(source.montantCentimes)} ct sur ${String(source.ligne.ttcCentimes)} ct d'origine) — aucun retour physique n'est présumé, enregistrez-le manuellement si la pièce revient réellement.`,
        {
          ligneDocumentId: source.ligne.id,
          mouvementOrigineId: mouvementOrigine.id,
          montantCrediteCentimes: source.montantCentimes,
          montantOriginalCentimes: source.ligne.ttcCentimes,
        },
      );
      return;
    }

    // `mouvement_stock_transfert_sites_chk` (0025) garantit `siteId` non nul pour tout type hors
    // `transfert` — `sortie_comptoir` en fait partie ; un `null` ici trahirait une donnée de base
    // incohérente avec sa propre contrainte, remonté bruyamment plutôt que masqué par un cast.
    if (mouvementOrigine.siteId == null) {
      throw new ErreurMetier(
        'ERREUR_INTERNE',
        `Mouvement ${mouvementOrigine.id} de type sortie_comptoir sans siteId — incohérent avec mouvement_stock_transfert_sites_chk (0025).`,
      );
    }

    await this.serviceMouvement.retourClientPourLigneTx(tx, ctx, principal.role, {
      articleId: mouvementOrigine.articleId,
      siteId: mouvementOrigine.siteId,
      quantiteMillieme: Math.abs(mouvementOrigine.quantiteMillieme),
      documentVenteLigneId: ligneAvoir.id,
      motif: `Retour client — avoir sur facture ${factureLibelle} (RP-46).`,
    });
  }

  private validerFactureCreditable(doc: LigneDocumentVente): void {
    if (doc.typeDocument !== 'facture') {
      throw new ErreurMetier('VALIDATION_ECHOUEE', "Un avoir ne peut créditer qu'une facture.", {
        erreurs: [
          {
            champ: 'factureId',
            code: 'type_invalide',
            message: `« ${doc.typeDocument} » n'est pas une facture.`,
          },
        ],
      });
    }
    if (doc.statut !== 'emis') {
      throw new ErreurMetier(
        'DOCUMENT_TRANSITION_INTERDITE',
        `Seule une facture émise peut recevoir un avoir (statut actuel : ${doc.statut}).`,
        {
          blocages: [
            {
              type: 'document_vente',
              id: doc.id,
              libelle: doc.numero ?? doc.id,
              donnees: { statutActuel: doc.statut },
            },
          ],
        },
      );
    }
  }

  private resoudreLignesACrediter(
    facture: LigneDocumentVente,
    lignesFacture: readonly LigneLigneDocument[],
    entree: EntreeCreationAvoir,
  ): readonly { readonly ligne: LigneLigneDocument; readonly montantCentimes: number }[] {
    if (entree.portee === 'total') {
      return lignesFacture.map((ligne) => ({ ligne, montantCentimes: ligne.ttcCentimes }));
    }

    const parId = new Map(lignesFacture.map((l) => [l.id, l]));
    return entree.lignes.map((demande) => {
      const ligne = parId.get(demande.ligneDocumentId);
      if (!ligne) {
        throw new ErreurMetier(
          'RESSOURCE_INTROUVABLE',
          `Ligne ${demande.ligneDocumentId} introuvable sur la facture ${facture.numero ?? facture.id}.`,
        );
      }
      if (demande.montantTtcCentimes > ligne.ttcCentimes) {
        throw new ErreurMetier(
          'AVOIR_MONTANT_EXCEDENTAIRE',
          `Le montant crédité (${String(demande.montantTtcCentimes)} ct) dépasse le montant de la ligne d'origine (${String(ligne.ttcCentimes)} ct) — MD-23.`,
          {
            blocages: [
              {
                type: 'ligne_document',
                id: ligne.id,
                libelle: ligne.designation,
                donnees: {
                  montantOriginalCentimes: ligne.ttcCentimes,
                  montantDemandeCentimes: demande.montantTtcCentimes,
                },
              },
            ],
          },
        );
      }
      return { ligne, montantCentimes: demande.montantTtcCentimes };
    });
  }
}
