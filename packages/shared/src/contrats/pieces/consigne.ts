import { z } from 'zod';

import { STATUTS_CONSIGNE_ECHANGE_STANDARD, type StatutConsigneEchangeStandard } from './enums';
import { schemaDelaiJours } from './primitives';
import { schemaIdentifiant } from '../atelier/primitives';
import { schemaListeQuery } from '../filtres';
import { schemaParametresPage } from '../pagination';

/**
 * La consigne d'échange standard (`consigne_echange_standard`, ou colonnes portées directement par
 * `ligne_or`/`mouvement_stock` — §8, même remarque de conception que `reservation_piece`) —
 * `RP-37` → `RP-42`. Débloque `RF-100` (facturation, marquée non résolue sur trois questions de
 * terrain) : le métier pièces sait ce qui se passe physiquement, la facturation en découle.
 *
 * CRÉATION — AUCUN `POST /consignes` PUBLIC dans ce contrat. `RP-38` décrit un geste UNIQUE à la
 * pose : la ligne d'OR facture pièce + consigne, ET la vieille pièce est réceptionnée en stock,
 * « dans le même geste ». Ce geste est déclenché par l'atelier (réalisation de la ligne de dépose,
 * `POST /ordres-reparation/{orId}/lignes/{ligneId}/marquer-realisee`, GELÉ, hors périmètre) —
 * l'enregistrement de la consigne côté pièces en est un EFFET DE BORD serveur, pas un appel HTTP
 * séparé. Signalé à l'orchestrateur comme point d'intégration cross-module, même statut que la
 * note de `mouvement.ts` sur `sortie_comptoir`/`retour_client`.
 */

export interface ReponseConsigneEchangeStandard {
  readonly id: string;
  /** La ligne d'OR de DÉPOSE de la pièce d'échange standard (`RP-38`, §8). */
  readonly ligneOrId: string;
  readonly ordreReparationId: string;
  readonly articleId: string;
  readonly siteId: string;
  readonly statut: StatutConsigneEchangeStandard;
  /** TTC, figé au moment de la pose (`RP-38`, `RP-42`) — copie de
   *  `article.montantConsigneTtcCentimes` à cet instant, jamais recalculé après coup (même
   *  doctrine que tout montant figé sur une ligne d'OR/document). */
  readonly montantConsigneTtcCentimes: number;
  /** Renseigné une fois la facture émise côté facturation (`RF-100`) — champ de LECTURE, alimenté
   *  par un domaine hors périmètre de ce fichier ; `null` tant que la ligne n'est pas facturée. */
  readonly documentVenteLigneConsigneId: string | null;
  readonly mouvementEntreeId: string;
  /** Renseignés uniquement pour `statut = 'retournee_fournisseur'` (`RP-39`). */
  readonly retourneeFournisseurLe: string | null;
  readonly mouvementRetourId: string | null;
  /** Renseigné une fois l'avoir partiel émis côté facturation (`RF-100`) — même remarque que
   *  `documentVenteLigneConsigneId` : lecture seule, alimenté hors périmètre. */
  readonly avoirDocumentId: string | null;
  readonly creeLe: string;
}

/* ------------------------------------------------------------------ */
/* Lecture — collection                                                */
/* ------------------------------------------------------------------ */

export const TRIS_CONSIGNES = ['creeLe:desc', 'creeLe:asc'] as const;
export const TRI_DEFAUT_CONSIGNES = 'creeLe:desc';

/**
 * `GET /consignes` — sert directement `§7.7` : « le système doit pouvoir afficher une liste de
 * consignes non soldées après N jours (P), sans jamais les solder tout seul ». `ancienneteJoursMin`
 * filtre sur `creeLe`, calculé côté serveur — AUCUNE action de ce contrat ne solde une consigne
 * automatiquement (`RP-41` : « propose qu'il s'agisse d'une action explicite et journalisée »,
 * non tranchée, voir `QP-07` dans le rapport d'accompagnement).
 */
export const schemaFiltresConsignes = schemaParametresPage.extend({
  statut: schemaListeQuery(z.enum(STATUTS_CONSIGNE_ECHANGE_STANDARD)).optional(),
  siteId: schemaIdentifiant.optional(),
  ancienneteJoursMin: schemaDelaiJours.optional(),
  tri: z.enum(TRIS_CONSIGNES).default(TRI_DEFAUT_CONSIGNES),
});
export type FiltresConsignes = z.infer<typeof schemaFiltresConsignes>;

/* ------------------------------------------------------------------ */
/* Action                                                               */
/* ------------------------------------------------------------------ */

/**
 * `POST /consignes/{id}/marquer-retour-fournisseur` — LE geste de comptoir de `RP-40` : le client
 * ramène la vieille pièce. Génère le mouvement `retour_consigne`, `statut →
 * retournee_fournisseur` (TERMINAL).
 *
 * `RP-40` exige que ce geste et l'avoir partiel côté facturation (`RF-100`) arrivent ENSEMBLE,
 * « jamais l'un sans l'autre ». Ce contrat NE PEUT PAS garantir cette atomicité à lui seul :
 * l'avoir est une écriture facturation (hors périmètre, contrat gelé). Recommandation figée ici
 * pour l'implémentation, mais PAS tranchée (décision cross-module) : un seul appel orchestrant les
 * deux écritures dans une même transaction — probablement porté par l'action d'avoir de
 * facturation elle-même, qui appellerait ce service en interne plutôt que d'exposer deux endpoints
 * indépendants que le front devrait enchaîner. Signalé à l'orchestrateur, pas figé.
 *
 * Pas d'`Idempotency-Key` : transition gardée par l'état de départ
 * (`409 CONSIGNE_TRANSITION_INTERDITE` si `statut !== 'en_attente_retour_fournisseur'`).
 */
export const schemaRetourFournisseurConsigne = z.object({});
export type EntreeRetourFournisseurConsigne = z.infer<typeof schemaRetourFournisseurConsigne>;
