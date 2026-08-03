import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type {
  EntreeAnnulerDocument,
  EntreeRefuserDocument,
  ReponseAvecAvertissements,
  ReponseDocumentVente,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../../db';
import {
  documentVente,
  documentVenteTva,
  ligneDocument,
  type LigneDocumentVente,
} from '../../db/schema';
import { MATRICE_DROITS, type Action } from '../../auth/matrice-droits';
import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import { ErreurMetier } from '../../common/erreurs/erreur-metier';
import { Horloge } from '../../common/horloge/horloge';
import { JETON_EVENEMENTS, type ServiceEvenements } from '../../common/evenements';
import {
  JETON_IDEMPOTENCE,
  type ReponseMemorisable,
  type ResultatIdempotent,
  type ServiceIdempotence,
} from '../../common/idempotence';
import { JETON_COMPTEURS } from '../../parametrage/compteurs/compteurs.jetons';
import type { ServiceCompteurs } from '../../parametrage/compteurs/compteurs.types';

import {
  agregerTvaParTauxRegime,
  calculerLigneDocument,
  calculerTotauxDocument,
  resoudreRemiseGlobaleCentimes,
  ventilerRemiseGlobale,
} from './calcul-document';
import {
  chargerDocumentPourEcriture,
  chargerPlafondAvoirReceptionnaire,
  listerLignesDocumentPourEcriture,
  sommerAvoirsEmisPourFacture,
} from './document-requetes';
import { traduireErreurDocument } from './erreurs-sql-document';
import { genererNumeroDocument } from './numerotation';
import { construireBlocQrPourEmission, resoudreBlocCreancierPourEmission } from './qr-emission';
import { adresseDepuisJsonb, ServiceDocumentsVente } from './service-documents';

/**
 * Transitions du document de vente (§7.7-like, `RF-1` → `RF-32`) : émission (le point de
 * non-retour, `RF-10`), et les trois transitions annexes simples (`accepter`, `refuser`,
 * `annuler`). Machine à états EN DONNÉES (`transition_document_autorisee`, migration 0010 §6) —
 * ce service ne réimplémente aucune règle de légalité de transition, il se contente d'écrire le
 * statut et de traduire le `ZDFA1` si la base refuse.
 */
@Injectable()
export class ServiceEmissionDocument {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    @Inject(JETON_EVENEMENTS) private readonly evenements: ServiceEvenements,
    @Inject(JETON_COMPTEURS) private readonly compteurs: ServiceCompteurs,
    private readonly horloge: Horloge,
    private readonly documents: ServiceDocumentsVente,
  ) {}

  /**
   * `POST /documents-vente/{id}/emettre` — `Idempotency-Key` OBLIGATOIRE (`RF-25`). Tout ce qui
   * peut échouer s'exécute AVANT l'allocation du numéro (`RF-26`) : ventilation de la remise
   * globale, recalcul des lignes, agrégation TVA — la ligne de compteur n'est touchée qu'à la toute
   * fin, dans la même transaction que l'écriture du document (un `ROLLBACK` ne consomme donc
   * jamais de numéro, `RF-23`/`RF-24`).
   *
   * Applicable aux QUATRE types de document (`devis`, `bon_commande`, `facture`, `avoir`) — un
   * seul point d'écriture pour `RF-5`/`MD-18`, cohérent avec `schemaEmissionDocumentVente` qui ne
   * distingue pas le type.
   */
  async emettre(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    documentId: string,
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
        chemin: '/documents-vente/:id/emettre',
        cle: cleIdempotence,
        corps: { documentId },
      },
      async (tx) => {
        const doc = await chargerDocumentPourEcriture(tx, ctx, documentId);
        if (doc.statut !== 'brouillon') {
          throw new ErreurMetier(
            'DOCUMENT_VERROUILLE',
            `Seul un brouillon peut être émis (statut actuel : ${doc.statut}).`,
            {
              blocages: [
                {
                  type: 'document_vente',
                  id: documentId,
                  libelle: doc.numero ?? documentId,
                  donnees: { statutActuel: doc.statut },
                },
              ],
              actionsProposees: [{ code: 'RAFRAICHIR' }],
            },
          );
        }

        this.verifierDroitEmission(doc.typeDocument, principal);

        const lignes = await listerLignesDocumentPourEcriture(tx, ctx, documentId);

        // 1. MD-59/60 : résout et ventile la remise globale de pied de document sur les lignes,
        // MAINTENANT — jamais avant (le brouillon peut tout contenir, MD-61).
        const sommeBase = lignes.reduce((s, l) => s + l.baseCentimes, 0);
        const remiseGlobaleCentimes = resoudreRemiseGlobaleCentimes(
          doc.remiseGlobaleSaisieCentimes != null ? Number(doc.remiseGlobaleSaisieCentimes) : null,
          doc.remiseGlobalePourmille,
          sommeBase,
        );
        const parts = ventilerRemiseGlobale(
          lignes.map((l) => ({
            id: l.id,
            numeroOrdre: l.numeroOrdre,
            baseCentimes: l.baseCentimes,
          })),
          remiseGlobaleCentimes,
        );

        // 2. Recalcule chaque ligne avec sa part de remise globale, écrit le résultat figé.
        const lignesRecalculees = lignes.map((ligne) => {
          const remiseGlobaleRepartieCentimes = parts.get(ligne.id) ?? 0;
          const montants = calculerLigneDocument({
            prixUnitaireTtcCentimes: ligne.prixUnitaireCentimes,
            quantiteMillieme: ligne.quantiteMillieme,
            remisePourmille: ligne.remisePourmille,
            remiseMontantCentimes: ligne.remiseMontantCentimes,
            remiseGlobaleRepartieCentimes,
            tauxTvaPourmille: ligne.tauxTvaPourmille,
          });
          return { ...ligne, remiseGlobaleRepartieCentimes, ...montants };
        });

        for (const ligne of lignesRecalculees) {
          await tx
            .update(ligneDocument)
            .set({
              remiseGlobaleRepartieCentimes: ligne.remiseGlobaleRepartieCentimes,
              baseCentimes: ligne.baseCentimes,
              htCentimes: ligne.htCentimes,
              tvaCentimes: ligne.tvaCentimes,
              ttcCentimes: ligne.ttcCentimes,
            })
            .where(and(eq(ligneDocument.tenantId, ctx.tenantId), eq(ligneDocument.id, ligne.id)));
        }

        // 2.5. RF-54/PF-03/MD-73 : bloc créancier — uniquement une FACTURE doit être payée (devis et
        // bon de commande n'exigent jamais de coordonnées bancaires ; un avoir crédite le client, il
        // ne se paie pas par QR-facture, donc n'en porte jamais). Vérifié ICI, avant l'allocation du
        // numéro (RF-26) : une facture ne doit jamais consommer un numéro pour finir sans QR faute de
        // coordonnées bancaires du garage — voir `qr-emission.ts`.
        const blocCreancier =
          doc.typeDocument === 'facture' ? await resoudreBlocCreancierPourEmission(tx, ctx) : null;

        // 3. MD-44/45 : agrège la TVA par (régime, taux) depuis les lignes — jamais sur le total.
        const ventilation = agregerTvaParTauxRegime(
          lignesRecalculees.map((l) => ({
            regimeTva: l.regimeTva,
            tauxTvaPourmille: l.tauxTvaPourmille,
            htCentimes: l.htCentimes,
            tvaCentimes: l.tvaCentimes,
          })),
        );
        const totaux = calculerTotauxDocument(lignesRecalculees);

        // 3.5. RF-117 : plafond d'émission d'avoir pour `receptionnaire` seul (direction/comptable
        // ne sont jamais bornés). Ne peut être vérifié qu'ICI — le TTC réel n'existe qu'après
        // ventilation de la remise globale et recalcul des lignes (étapes 1-3 ci-dessus) — jamais
        // avant, et jamais après l'allocation du numéro (étape 4) : un refus ici, comme tout ce qui
        // précède, fait échouer la transaction ENTIÈRE (aucune ligne recalculée ni aucun numéro
        // n'est committé, RF-23/24) — même garantie que `verifierDroitEmission` plus haut, seulement
        // décalée dans le temps parce que la donnée qu'elle contrôle n'existe pas encore à ce
        // moment-là. Même patron que `atelier.or.plafond_modifier` (`atelier/service-or.ts`) :
        // vérification conditionnelle, posée dans le service après chargement de la valeur réelle,
        // pas un `@ExigerDroit` statique qui ne pourrait pas connaître le montant.
        if (doc.typeDocument === 'avoir') {
          await this.verifierPlafondAvoirReceptionnaire(
            tx,
            ctx,
            principal,
            doc,
            totaux.totalTtcCentimes,
          );
        }

        // 4. RF-22/RF-23 : le numéro n'est alloué qu'ICI, tout le reste a déjà pu échouer avant.
        const maintenant = this.horloge.maintenant();
        const dateDocumentReference = doc.dateDocument
          ? new Date(`${doc.dateDocument}T00:00:00.000Z`)
          : maintenant;
        const { numero, numeroSequence, exercice } = await genererNumeroDocument(
          tx,
          ctx,
          this.compteurs,
          doc.typeDocument,
          dateDocumentReference,
        );

        // 4.5. Charge utile QR (MD-73→MD-81) — APRÈS le numéro : le message non structuré et, pour
        // un IBAN ordinaire, la référence SCOR en dérivent. Le bloc débiteur vient de l'adresse DÉJÀ
        // figée à la création du document (`adresse_facturation_figee`, MD-24) — jamais recalculée
        // depuis la fiche client courante.
        const adresseDebiteurFigee = adresseDepuisJsonb(doc.adresseFacturationFigee);
        const debiteurQr = adresseDebiteurFigee
          ? { nom: doc.clientDesignationFigee, ...adresseDebiteurFigee }
          : null;
        const blocQr = blocCreancier
          ? await construireBlocQrPourEmission(tx, ctx, this.compteurs, {
              creancier: blocCreancier,
              numero,
              exercice,
              totalTtcCentimes: totaux.totalTtcCentimes,
              devise: doc.devise,
              debiteur: debiteurQr,
            })
          : null;

        try {
          await tx
            .update(documentVente)
            .set({
              statut: 'emis',
              numero,
              numeroSequence,
              exercice,
              emisLe: maintenant,
              totalHtCentimes: BigInt(totaux.totalHtCentimes),
              totalTvaCentimes: BigInt(totaux.totalTvaCentimes),
              totalTtcCentimes: BigInt(totaux.totalTtcCentimes),
              ...(blocQr
                ? {
                    qrIban: blocQr.qrIban,
                    creancierNom: blocQr.creancierNom,
                    creancierRue: blocQr.creancierRue,
                    creancierNumero: blocQr.creancierNumero,
                    creancierNpa: blocQr.creancierNpa,
                    creancierLocalite: blocQr.creancierLocalite,
                    creancierPays: blocQr.creancierPays,
                    typeReferenceQr: blocQr.typeReferenceQr,
                    qrReference: blocQr.qrReference,
                    qrMontantCentimes: BigInt(blocQr.qrMontantCentimes),
                    qrDevise: blocQr.qrDevise,
                    qrLangue: doc.langueFigee,
                    qrDebiteurPresent: blocQr.qrDebiteurPresent,
                    qrPayload: blocQr.qrPayload,
                    qrPayloadSha256: blocQr.qrPayloadSha256,
                  }
                : {}),
            })
            .where(and(eq(documentVente.tenantId, ctx.tenantId), eq(documentVente.id, documentId)));
        } catch (erreur) {
          const traduite = traduireErreurDocument(erreur, documentId, doc.numero);
          if (traduite) throw traduite;
          throw erreur;
        }

        // 5. MD-45 : le récapitulatif TVA est figé, append-only, écrit UNE SEULE FOIS ici.
        for (const v of ventilation) {
          await tx.insert(documentVenteTva).values({
            tenantId: ctx.tenantId,
            documentId,
            regimeTva: v.regimeTva as (typeof documentVenteTva.$inferInsert)['regimeTva'],
            tauxTvaPourmille: v.tauxTvaPourmille,
            baseCentimes: v.baseCentimes,
            tvaCentimes: v.tvaCentimes,
          });
        }

        // 6. RF-32 : un avoir 'total' clôt la facture créditée — colonnes de la liste blanche
        // post-émission (`annule_par_avoir_id`, MD-20), écrites ICI plutôt que dans `service-avoir.ts`
        // pour ne mettre à jour la facture qu'au moment où l'avoir devient réellement opposable
        // (émis), jamais sur un avoir encore en brouillon qui pourrait être abandonné.
        if (doc.typeDocument === 'avoir' && doc.porteeAvoir === 'total' && doc.factureAnnuleeId) {
          try {
            await tx
              .update(documentVente)
              .set({ statut: 'annule_par_avoir', annuleParAvoirId: documentId })
              .where(
                and(
                  eq(documentVente.tenantId, ctx.tenantId),
                  eq(documentVente.id, doc.factureAnnuleeId),
                ),
              );
          } catch (erreur) {
            const traduite = traduireErreurDocument(erreur, doc.factureAnnuleeId, null);
            if (traduite) throw traduite;
            throw erreur;
          }
        }

        // 7. Événement — catalogue GELÉ (`@dfa/shared`) : seuls `facture.emise`/`avoir.emis` existent,
        // rien pour `devis`/`bon_commande` (réservés étape 2, jamais émis avant). Aucun événement
        // n'est inventé pour les deux autres types.
        if (doc.typeDocument === 'facture') {
          await this.evenements.publier(tx, ctx, {
            type: 'facture.emise',
            versionSchema: 1,
            siteId: doc.siteId,
            ressource: { type: 'document_vente', id: documentId, numero },
            donnees: {
              natureFacture: doc.natureFacture,
              totalTtcCentimes: totaux.totalTtcCentimes,
            },
          });
        } else if (doc.typeDocument === 'avoir') {
          await this.evenements.publier(tx, ctx, {
            type: 'avoir.emis',
            versionSchema: 1,
            siteId: doc.siteId,
            ressource: { type: 'document_vente', id: documentId, numero },
            donnees: {
              factureAnnuleeId: doc.factureAnnuleeId,
              portee: doc.porteeAvoir,
              totalTtcCentimes: totaux.totalTtcCentimes,
            },
          });
        }

        const document = await this.documents.assemblerDocument(
          tx,
          ctx,
          principal.role,
          documentId,
        );
        return { statutHttp: 200, corps: { donnees: document, avertissements: [] } };
      },
    );
  }

  /** `POST /documents-vente/{id}/accepter` — devis uniquement (`devis.emis → accepte`, terminal). */
  async accepter(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    documentId: string,
  ): Promise<ReponseAvecAvertissements<ReponseDocumentVente>> {
    return this.transitionnerSimple(ctx, principal, documentId, 'accepte', (doc) => {
      if (doc.typeDocument !== 'devis') {
        throw new ErreurMetier('VALIDATION_ECHOUEE', 'Seul un devis peut être accepté.', {
          erreurs: [
            {
              champ: 'typeDocument',
              code: 'type_invalide',
              message: `« ${doc.typeDocument} » ne peut pas être accepté.`,
            },
          ],
        });
      }
    });
  }

  /** `POST /documents-vente/{id}/refuser` — devis ou bon de commande.
   *  `motif` (optionnel, `schemaRefuserDocument`) : SIGNALÉ — aucune colonne `motif_refus` n'existe
   *  sur `document_vente` (contrairement à `motif_avoir`/`motif_avoir_libre` pour l'avoir, ou
   *  `ordre_reparation.motif_annulation` pour l'OR). Le motif est validé par le schéma d'entrée
   *  mais n'a nulle part où se poser dans ce lot — à signaler à expert-database. */
  async refuser(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    documentId: string,
    entree: EntreeRefuserDocument,
  ): Promise<ReponseAvecAvertissements<ReponseDocumentVente>> {
    void entree;
    return this.transitionnerSimple(ctx, principal, documentId, 'refuse', (doc) => {
      if (doc.typeDocument !== 'devis' && doc.typeDocument !== 'bon_commande') {
        throw new ErreurMetier(
          'VALIDATION_ECHOUEE',
          'Seuls un devis ou un bon de commande peuvent être refusés.',
          {
            erreurs: [
              {
                champ: 'typeDocument',
                code: 'type_invalide',
                message: `« ${doc.typeDocument} » ne peut pas être refusé.`,
              },
            ],
          },
        );
      }
    });
  }

  /** `POST /documents-vente/{id}/annuler` — bon de commande uniquement, motif obligatoire
   *  (`schemaAnnulerDocument`). Même limitation signalée que `refuser` : pas de colonne de
   *  persistance pour le motif sur `document_vente`. */
  async annuler(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    documentId: string,
    entree: EntreeAnnulerDocument,
  ): Promise<ReponseAvecAvertissements<ReponseDocumentVente>> {
    void entree;
    return this.transitionnerSimple(ctx, principal, documentId, 'annule', (doc) => {
      if (doc.typeDocument !== 'bon_commande') {
        throw new ErreurMetier('VALIDATION_ECHOUEE', 'Seul un bon de commande peut être annulé.', {
          erreurs: [
            {
              champ: 'typeDocument',
              code: 'type_invalide',
              message: `« ${doc.typeDocument} » ne peut pas être annulé.`,
            },
          ],
        });
      }
    });
  }

  /**
   * `RF-114` distingue trois droits d'émission selon `typeDocument` (voir la note détaillée sur le
   * type `Action`, `auth/matrice-droits.ts`) — `@ExigerDroit('facturation.document.emettre')` posé
   * sur la route n'est que le portillon générique (« au moins un des trois »). Vérification
   * PRÉCISE ici, après chargement du document réel — même patron que
   * `ServiceOr.modifier` pour `atelier.or.plafond_modifier` (`atelier/service-or.ts`).
   */
  private verifierDroitEmission(
    typeDocument: LigneDocumentVente['typeDocument'],
    principal: PrincipalAuthentifie,
  ): void {
    const action: Action =
      typeDocument === 'facture'
        ? 'facturation.document.emettre_facture'
        : typeDocument === 'avoir'
          ? 'facturation.document.emettre_avoir'
          : 'facturation.document.emettre_devis_bc';
    const droitsDuRole = MATRICE_DROITS[principal.role] ?? [];
    if (!droitsDuRole.includes(action)) {
      throw new ErreurMetier(
        'DROIT_INSUFFISANT',
        `Le rôle "${principal.role}" n'a pas le droit d'émettre un document de type "${typeDocument}" (RF-114).`,
      );
    }
  }

  /**
   * `RF-117` : ferme le dégradé documenté dans `auth/matrice-droits.ts` (§EMISSION_AVOIR,
   * commentaire « RF-117 NON IMPLÉMENTÉ, SIGNALÉ ») — `receptionnaire` détient
   * `facturation.document.emettre_avoir` SANS AUCUNE LIMITE aujourd'hui ; au-delà d'un montant
   * paramétré par tenant, `direction`/`comptable` doivent prendre le relais.
   *
   * `parametre_atelier.plafond_avoir_receptionnaire_centimes` (migration 0018) : NULL = aucun
   * plafond convenu — comportement actuel PRÉSERVÉ à l'identique (non-régression prioritaire,
   * voir l'en-tête de la migration §3). Ne s'applique qu'au rôle `receptionnaire` — le nom de la
   * colonne le dit, `direction`/`comptable`/`admin` ne sont jamais bornés par elle.
   *
   * MONTANT COMPARÉ — décision prise ici, faute de trancher explicite dans la spécification :
   *  - le TTC, pas le HT : un avoir rend de l'argent au client, et les prix sont stockés TVA
   *    comprise (arbitrage @laupernoe) — le TTC est ce que le client récupère réellement. Un avoir porte
   *    un total `<= 0` par construction (`document_vente` : `type_document <> 'avoir' or (...
   *    total_ttc_centimes <= 0)`, migration 0010 §9) ; sa valeur absolue est le montant rendu —
   *    même convention que le trigger `imputation_paiement_verifier_invariants` (migration 0010,
   *    MD-51, `abs(d.total_ttc_centimes)`), pas une invention de cet agent.
   *  - CUMUL sur la facture d'origine, pas seulement le montant de CET avoir : `RF-117` ne
   *    précise pas le cas d'un avoir PARTIEL émis après d'autres avoirs déjà émis sur la même
   *    facture. Lecture retenue, la plus prudente (celle qui protège le plus) faute de trancher
   *    explicite : un `receptionnaire` ne doit pas pouvoir contourner le plafond en fractionnant
   *    un gros avoir en plusieurs avoirs partiels, chacun sous le seuil pris isolément — le cumul
   *    de ce que le client a déjà récupéré + ce que CET avoir ajoute est comparé au plafond. Ne
   *    compte que les avoirs déjà ÉMIS (`statut = 'emis'`) sur la même `facture_annulee_id` : un
   *    avoir encore en brouillon n'est pas opposable et peut être abandonné (RF-9), il ne doit pas
   *    gonfler artificiellement le cumul. À SIGNALER à @laupernoe/expert-metier pour confirmation — c'est
   *    la lecture la plus protectrice, pas une certitude tirée de la spec.
   *
   * Un avoir sans `factureAnnuleeId` (avoir libre) n'a pas de cumul à calculer : seul son propre
   * montant compte.
   */
  private async verifierPlafondAvoirReceptionnaire(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    doc: LigneDocumentVente,
    totalAvoirTtcCentimes: number,
  ): Promise<void> {
    if (principal.role !== 'receptionnaire') return;

    const plafondCentimes = await chargerPlafondAvoirReceptionnaire(tx, ctx);
    if (plafondCentimes === null) return; // NULL = aucun plafond convenu (0018 §3) — inchangé.

    const cumulDejaEmisCentimes = doc.factureAnnuleeId
      ? await sommerAvoirsEmisPourFacture(tx, ctx, doc.factureAnnuleeId)
      : 0;
    const cumulCentimes = Math.abs(totalAvoirTtcCentimes) + cumulDejaEmisCentimes;

    if (cumulCentimes > plafondCentimes) {
      throw new ErreurMetier(
        'AVOIR_PLAFOND_DEPASSE',
        `Le montant de l'avoir (${String(cumulCentimes)} centimes, cumulé sur la facture d'origine) dépasse le plafond de ${String(plafondCentimes)} centimes autorisé au rôle "receptionnaire" seul (RF-117) — direction ou comptable doit émettre cet avoir.`,
        {
          blocages: [
            {
              type: 'document_vente',
              id: doc.id,
              libelle: doc.numero ?? doc.id,
              donnees: { plafondCentimes, cumulCentimes },
            },
          ],
          actionsProposees: [{ code: 'DEMANDER_HABILITATION' }],
        },
      );
    }
  }

  private async transitionnerSimple(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    documentId: string,
    versStatut: LigneDocumentVente['statut'],
    validerType: (doc: LigneDocumentVente) => void,
  ): Promise<ReponseAvecAvertissements<ReponseDocumentVente>> {
    return this.acces.enTenant(ctx, async (tx) => {
      const doc = await chargerDocumentPourEcriture(tx, ctx, documentId);
      validerType(doc);
      try {
        await tx
          .update(documentVente)
          .set({ statut: versStatut })
          .where(and(eq(documentVente.tenantId, ctx.tenantId), eq(documentVente.id, documentId)));
      } catch (erreur) {
        const traduite = traduireErreurDocument(erreur, documentId, doc.numero);
        if (traduite) throw traduite;
        throw erreur;
      }
      const document = await this.documents.assemblerDocument(tx, ctx, principal.role, documentId);
      return { donnees: document, avertissements: [] };
    });
  }
}
