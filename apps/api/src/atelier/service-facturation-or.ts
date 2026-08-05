import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type {
  EntreeFacturationOrdreReparation,
  ReponseAvecAvertissements,
  ReponseDocumentVente,
  ReponseFacturationOrdreReparation,
  SelecteurGroupePayeurOr,
  TypeLigneDocumentVente,
} from '@dfa/shared';

import { JETON_DB, type AccesBase, type ContexteTenant, type TransactionDfa } from '../db';
import {
  documentVente,
  ligneDocument,
  ligneOr,
  ordreReparation,
  type LigneClient,
  type LigneLigneOr,
  type LigneOrdreReparation,
} from '../db/schema';
import type { PrincipalAuthentifie } from '../common/contexte/contexte-requete.types';
import { ErreurMetier } from '../common/erreurs/erreur-metier';
import { Horloge } from '../common/horloge/horloge';
import {
  JETON_IDEMPOTENCE,
  type ReponseMemorisable,
  type ResultatIdempotent,
  type ServiceIdempotence,
} from '../common/idempotence';

import { calculerLigneDocument } from '../facturation/documents/calcul-document';
import {
  chargerAdresseFacturationStructuree,
  chargerConditionsPaiementEnVigueur,
} from '../facturation/documents/references';
import { ServiceDocumentsVente } from '../facturation/documents/service-documents';

import { verifierConfirmation } from './confirmations';
import { chargerClientLigne, nomAfficheClient } from './references';
import { chargerOrPourEcriture, listerLignesOrPourEcriture } from './or-requetes';
import { ServiceOr } from './service-or';
import { traduireErreurTransition } from './traducteur-transition';

/**
 * `POST /ordres-reparation/{orId}/facturer` (`RF-81`) — LE PONT entre l'atelier et la facturation.
 * Contrat figé, fait foi : `packages/shared/src/contrats/facturation/facturer-or.ts` — lire son
 * en-tête AVANT de modifier ce fichier, il tranche déjà la quasi-totalité des questions
 * d'interface (sélection par groupe payeur, facturation partielle rejouable, 1 OR ↔ N documents,
 * `ligne_or.statut realisee -> facturee`).
 *
 * Ne crée que des BROUILLONS (`RF-81` : « le bouton dit Créer, jamais Émettre ») — l'émission
 * reste `POST /documents-vente/{id}/emettre` (`facturation/documents/service-emission.ts`, hors
 * périmètre de ce service). Aucun numéro n'est donc alloué ici (`RF-9`/`RF-20` : la numérotation
 * n'a lieu qu'à l'émission).
 *
 * Statuts couverts par les codes d'erreur déjà posés au lot 1, AUCUN NOUVEAU CODE (voir l'en-tête
 * du contrat pour la liste complète et sa justification) : `OR_TRANSITION_INTERDITE`,
 * `FACTURATION_LIGNES_INDECISES`, `OR_FACTURATION_AUCUNE_LIGNE`, `CONFIRMATION_REQUISE`,
 * `IDEMPOTENCE_CONFLIT`, `DROIT_INSUFFISANT`. La validation de FORME du corps (groupe dupliqué,
 * `payeurClientId` incohérent, groupe à la fois facturé et reporté) est ENTIÈREMENT couverte par
 * `schemaFacturationOrdreReparation` (zod, `.refine()`) — ce service ne la répète pas.
 */
const STATUTS_LIGNE_INDECIS: ReadonlySet<LigneLigneOr['statut']> = new Set([
  'proposee',
  'a_valider',
  'validee',
  'en_cours',
]);

/** RF-92/RM-70/MD-66 : une ligne `payeur = 'garage'` n'est JAMAIS un groupe sélectionnable à part
 *  (`PAYEURS_FACTURATION_SELECTIONNABLES` l'exclut) — elle voyage automatiquement avec le groupe
 *  `'client'` du même OR, valorisée à 0 côté facturable. Pour tout autre groupe, correspondance
 *  stricte sur la paire (`MD-62`). Exportée pour test unitaire pur (`service-facturation-or.spec.ts`).
 */
export function ligneAppartientAuGroupe(
  ligne: LigneLigneOr,
  groupe: SelecteurGroupePayeurOr,
): boolean {
  if (groupe.payeur === 'client') return ligne.payeur === 'client' || ligne.payeur === 'garage';
  return ligne.payeur === groupe.payeur && ligne.payeurClientId === (groupe.payeurClientId ?? null);
}

/**
 * `ligne_or.type` -> `ligne_document.type_ligne` : les DEUX vocabulaires partagent neuf valeurs à
 * l'identique (`packages/shared/.../facturation/enums.ts`, commentaire de
 * `TYPES_LIGNE_DOCUMENT_VENTE` : « reprend le vocabulaire des types de ligne d'OR »). SEUL
 * `'remise'` (atelier) n'a pas d'équivalent facturation — `RF-45` l'exclut délibérément des lignes
 * de document (« une remise de pied de facture est TOUJOURS ventilée sur les lignes existantes »).
 * Le contrat ne dit RIEN de la recopie d'une ligne d'OR de type `remise` par CETTE action précise
 * (RF-81) : INTERPRÉTATION SIGNALÉE, non tranchée par le contrat — repli sur `'repartition'` (le
 * seul type de document qui porte déjà la notion de ligne signée hors remise de pied de page), à
 * confirmer avec expert-facturation/@laupernoe. Exportée pour test unitaire pur.
 */
export function typeLigneDocumentDepuisOr(type: LigneLigneOr['type']): TypeLigneDocumentVente {
  if (type === 'remise') return 'repartition';
  return type;
}

@Injectable()
export class ServiceFacturationOr {
  constructor(
    @Inject(JETON_DB) private readonly acces: AccesBase,
    @Inject(JETON_IDEMPOTENCE) private readonly idempotence: ServiceIdempotence,
    private readonly horloge: Horloge,
    private readonly serviceOr: ServiceOr,
    private readonly documents: ServiceDocumentsVente,
  ) {}

  async facturer(
    ctx: ContexteTenant,
    principal: PrincipalAuthentifie,
    orId: string,
    entree: EntreeFacturationOrdreReparation,
    cleIdempotence: string,
  ): Promise<
    ResultatIdempotent<
      ReponseMemorisable & { corps: ReponseAvecAvertissements<ReponseFacturationOrdreReparation> }
    >
  > {
    return this.idempotence.executer(
      ctx,
      {
        methode: 'POST',
        chemin: '/ordres-reparation/:orId/facturer',
        cle: cleIdempotence,
        corps: { orId, ...entree },
      },
      async (tx) => {
        const or = await chargerOrPourEcriture(tx, ctx, orId);
        if (or.statut !== 'termine') {
          throw new ErreurMetier(
            'OR_TRANSITION_INTERDITE',
            `Seul un OR « termine » peut être facturé (statut actuel : ${or.statut}).`,
            {
              blocages: [
                {
                  type: 'ordre_reparation',
                  id: orId,
                  libelle: or.numero,
                  donnees: { statutActuel: or.statut },
                },
              ],
              actionsProposees: [{ code: 'RAFRAICHIR' }],
            },
          );
        }

        const toutesLignes = await listerLignesOrPourEcriture(tx, ctx, orId);

        // RF-85/RF-86 : refusé tant qu'une ligne facturable de l'OR — TOUS groupes confondus, pas
        // seulement ceux demandés par cet appel — attend encore une décision.
        const indecises = toutesLignes.filter((l) => STATUTS_LIGNE_INDECIS.has(l.statut));
        if (indecises.length > 0) {
          throw new ErreurMetier(
            'FACTURATION_LIGNES_INDECISES',
            'Des lignes attendent encore une décision avant facturation (RF-85/RF-86).',
            {
              blocages: indecises.slice(0, 50).map((l) => ({
                type: 'ligne_or' as const,
                id: l.id,
                libelle: l.designation ?? '',
                donnees: { numeroLigne: l.numeroOrdre, statutActuel: l.statut },
              })),
              actionsProposees: [{ code: 'VALIDER_LIGNES' }],
            },
          );
        }

        const clientOrLigne = await chargerClientLigne(tx, ctx, or.clientId);
        const maintenant = this.horloge.maintenant();
        const dateDocument = maintenant.toISOString().slice(0, 10);
        const datePrestation = or.termineLe
          ? or.termineLe.toISOString().slice(0, 10)
          : dateDocument;

        const idsTraites = new Set<string>();
        const facturesCreees: ReponseDocumentVente[] = [];
        // Cache des fiches client destinataire déjà résolues (une par groupe, au plus) — évite de
        // recharger deux fois le même tiers si un appel invraisemblable le référence deux fois
        // (déjà exclu par `schemaFacturationOrdreReparation.refine`, filet supplémentaire ici).
        const clientsResolus = new Map<string, LigneClient>();

        for (const groupe of entree.groupes) {
          const lignesDuGroupe = toutesLignes.filter((l) => ligneAppartientAuGroupe(l, groupe));
          const lignesRealisees = lignesDuGroupe.filter((l) => l.statut === 'realisee');

          if (lignesRealisees.length === 0) {
            throw new ErreurMetier(
              'OR_FACTURATION_AUCUNE_LIGNE',
              `Aucune ligne « realisee » à facturer pour le groupe payeur « ${groupe.payeur} ».`,
              {
                blocages: [
                  {
                    type: 'ordre_reparation',
                    id: orId,
                    libelle: or.numero,
                    donnees: {
                      payeur: groupe.payeur,
                      payeurClientId: groupe.payeurClientId ?? null,
                    },
                  },
                ],
                actionsProposees: [{ code: 'RAFRAICHIR' }],
              },
            );
          }

          const destinataireId =
            groupe.payeur === 'client' ? or.clientId : (groupe.payeurClientId as string);
          const destinataireLigne =
            clientsResolus.get(destinataireId) ??
            (destinataireId === or.clientId
              ? clientOrLigne
              : await chargerClientLigne(tx, ctx, destinataireId));
          clientsResolus.set(destinataireId, destinataireLigne);

          if (destinataireLigne.statut === 'bloque') {
            verifierConfirmation('CLIENT_BLOQUE', principal.role, entree.confirmations);
          }

          const adresseFacturationFigee =
            (await chargerAdresseFacturationStructuree(tx, ctx, destinataireId)) ?? {};
          // RM-07/RF-04/PF-04, même patron que `facturation/documents/service-documents.ts::creer`
          // (défaut soldé, cf. rapport de livraison signalé par expert-facturation) : conditions de
          // paiement du DESTINATAIRE (pas forcément `or.clientId` — un groupe payeur `assurance`/
          // `constructeur`/`tiers` facture un tiers différent, RF-92) EN VIGUEUR à `dateDocument`.
          // `{}` si aucune ligne `client_condition` n'est en vigueur — jamais un délai fabriqué à
          // partir d'un défaut codé en dur (aucune colonne ne le porte, voir l'en-tête d'`echeance.ts`) :
          // l'échéance de cette facture reste alors `null`, honnête plutôt que fausse.
          const conditionsPaiementFigees = await chargerConditionsPaiementEnVigueur(
            tx,
            ctx,
            destinataireId,
            new Date(`${dateDocument}T00:00:00.000Z`),
          );

          const [doc] = await tx
            .insert(documentVente)
            .values({
              tenantId: ctx.tenantId,
              siteId: or.siteId,
              typeDocument: 'facture',
              natureFacture: 'ordinaire',
              statut: 'brouillon',
              clientId: destinataireId,
              vehiculeId: or.vehiculeId,
              ordreReparationId: or.id,
              clientDesignationFigee: nomAfficheClient(destinataireLigne),
              clientIdeFige: destinataireLigne.ide,
              langueFigee: destinataireLigne.langue,
              adresseFacturationFigee,
              conditionsPaiementFigees,
              dateDocument,
              devise: 'CHF',
            })
            .returning();
          if (!doc)
            throw new ErreurMetier(
              'ERREUR_INTERNE',
              "L'insertion du document de vente n'a rendu aucune ligne.",
            );

          let numeroOrdre = 1;
          for (const ligneOrCourante of lignesRealisees) {
            await this.inserterLigneDepuisOr(
              tx,
              ctx,
              doc.id,
              numeroOrdre++,
              ligneOrCourante,
              datePrestation,
            );

            try {
              await tx
                .update(ligneOr)
                .set({ statut: 'facturee', factureId: doc.id })
                .where(and(eq(ligneOr.tenantId, ctx.tenantId), eq(ligneOr.id, ligneOrCourante.id)));
            } catch (erreur) {
              const traduite = traduireErreurTransition(
                erreur,
                ligneOrCourante.id,
                ligneOrCourante.designation ?? '',
              );
              if (traduite) throw traduite;
              throw erreur;
            }
            idsTraites.add(ligneOrCourante.id);
          }

          facturesCreees.push(
            await this.documents.assemblerDocument(tx, ctx, principal.role, doc.id),
          );
        }

        // `inclureDemontageRefuse`/`motifsReport` : voir l'en-tête du contrat (`facturer-or.ts`) —
        // `demontageFacturablePropose` n'est calculé par AUCUN service au lot 1 (toujours `undefined`
        // sur `ReponseOrdreReparation`, voir `service-or.ts::assemblerDocument`), donc l'option n'a
        // structurellement aucun démontage à ajouter ici — pas un oubli, une conséquence directe de
        // l'absence de la fonctionnalité source. `motifsReport` est validé par le schéma d'entrée
        // (zod) mais SIGNALÉ COMME NON PERSISTÉ par le contrat lui-même (« décision d'implémentation,
        // hors périmètre de ce fichier ») : accepté silencieusement, comme le contrat l'anticipe.
        void entree.inclureDemontageRefuse;
        void entree.motifsReport;

        // RF-84 : l'OR ne passe à `facture` QUE si cet appel traite le DERNIER groupe encore
        // facturable — une ligne `realisee` qui n'appartenait à AUCUN groupe demandé reste en
        // attente, l'OR reste `termine`.
        const resteAFacturer = toutesLignes.some(
          (l) => l.statut === 'realisee' && !idsTraites.has(l.id),
        );
        if (!resteAFacturer) {
          await this.transitionnerVersFacture(tx, ctx, or, maintenant);
        }

        const ordreReparationAJour = await this.serviceOr.assemblerDocument(
          tx,
          ctx,
          principal.role,
          orId,
        );
        return {
          statutHttp: 201,
          corps: {
            donnees: { facturesCreees, ordreReparation: ordreReparationAJour },
            avertissements: [],
          },
        };
      },
    );
  }

  private async transitionnerVersFacture(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    or: LigneOrdreReparation,
    maintenant: Date,
  ): Promise<void> {
    try {
      await tx
        .update(ordreReparation)
        .set({ statut: 'facture', factureLe: maintenant })
        .where(and(eq(ordreReparation.tenantId, ctx.tenantId), eq(ordreReparation.id, or.id)));
    } catch (erreur) {
      const traduite = traduireErreurTransition(erreur, or.id, or.numero);
      if (traduite) throw traduite;
      throw erreur;
    }
  }

  /**
   * Recopie UNE ligne d'OR `realisee` en ligne de document (`RF-81`, `MD-24` : figée, indépendante
   * de sa source dès l'instant où elle est écrite). Pipeline TTC-ancré obligatoire
   * (`ligne_document_mode_ttc_lot_pilote_chk`, migration 0010 §8) : `ligne_or.montantTtcCentimes`
   * (déjà figé à la création de la ligne d'OR, RM-65) devient le prix unitaire TTC d'une ligne de
   * quantité 1 — le TTC recopié est donc EXACT, la répartition HT/TVA peut différer d'un centime de
   * celle de l'OR (arrondi HT-ancré côté atelier vs TTC-ancré côté facturation, §0.2, décision de
   * @laupernoe du 29.07.2026) : c'est le TTC qui fait foi en cas d'écart, jamais l'inverse.
   *
   * `payeur = 'garage'` (RM-70, RF-92, MD-66, AC-07) : facturable posé à 0 sur les trois axes,
   * `montantValoriseCentimes` porte le coût réel — `mapperLigneDocument` (déjà posé,
   * `facturation/documents/mappeurs.ts`) n'a besoin d'AUCUN changement, il lit déjà cette colonne.
   */
  private async inserterLigneDepuisOr(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    documentId: string,
    numeroOrdre: number,
    ligne: LigneLigneOr,
    datePrestation: string,
  ): Promise<void> {
    const estLigneGarage = ligne.payeur === 'garage';
    const prixUnitaireTtcCentimes = estLigneGarage ? 0 : ligne.montantTtcCentimes;

    const montants = calculerLigneDocument({
      prixUnitaireTtcCentimes,
      quantiteMillieme: 1000,
      remisePourmille: null,
      remiseMontantCentimes: null,
      remiseGlobaleRepartieCentimes: 0,
      tauxTvaPourmille: ligne.tauxTvaPourmille,
    });

    await tx.insert(ligneDocument).values({
      tenantId: ctx.tenantId,
      documentId,
      numeroOrdre,
      typeLigne: typeLigneDocumentDepuisOr(ligne.type),
      designation: ligne.designation ?? '',
      referenceTexte: ligne.referenceTexte,
      ligneOrId: ligne.id,
      documentAcompteId: null,
      modeCalculTva: 'ttc',
      regimeTva: 'normal',
      tauxTvaPourmille: ligne.tauxTvaPourmille,
      datePrestation,
      quantiteMillieme: 1000,
      prixUnitaireCentimes: prixUnitaireTtcCentimes,
      remisePourmille: null,
      remiseMontantCentimes: null,
      remiseGlobaleRepartieCentimes: 0,
      baseCentimes: montants.baseCentimes,
      htCentimes: montants.htCentimes,
      tvaCentimes: montants.tvaCentimes,
      ttcCentimes: montants.ttcCentimes,
      montantValoriseCentimes: estLigneGarage ? ligne.montantTtcCentimes : null,
    });
  }
}
