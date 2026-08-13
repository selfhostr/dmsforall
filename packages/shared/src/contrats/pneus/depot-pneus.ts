import { z } from 'zod';

import {
  MOTIFS_SORTIE_DEPOT_PNEUS,
  SAISONS_PNEU,
  STATUTS_DEPOT_PNEUS,
  type MotifSortieDepotPneus,
  type SaisonPneu,
  type StatutDepotPneus,
} from './enums';
import { schemaIdentifiant } from '../atelier/primitives';
import { schemaListeQuery } from '../filtres';
import { schemaParametresPage } from '../pagination';

/**
 * Hangar à pneus — `depot_pneus`, `docs/specification-parc-et-hangar-pneus.md` §4.3, §5
 * (RPP-01 → RPP-08). Schéma posé par `apps/api/src/db/migrations/0043_pneus_depot_pneus.sql`.
 *
 * RPP-01 : jamais de `clientId` direct dans ce contrat — le client se lit en passant par
 * `vehiculeId` (`GET /vehicules/{id}` → `proprietaireEconomiqueClientId`/`vehicule_detention`,
 * hors périmètre de ce fichier).
 */

/**
 * Patron EXACT `pieces/primitives.ts::schemaEmplacement` (RPP-07) : texte libre, borne
 * applicative uniquement — la base (`depot_pneus.code_case`) ne porte aucun CHECK de longueur,
 * voir `migrations/0043_pneus_depot_pneus.sql` §C de son en-tête.
 */
export const schemaCodeCase = z.string().trim().max(60);

export interface ReponseDepotPneus {
  readonly id: string;
  readonly vehiculeId: string;
  readonly siteId: string;
  readonly saison: SaisonPneu;
  readonly statut: StatutDepotPneus;
  readonly codeCase: string | null;
  /** Recopié de `vehicule.pneusEte`/`pneusHiver` à l'entrée si non fourni (RPP, §4.3). */
  readonly dimension: string | null;
  readonly etat: string | null;
  readonly entreLe: string;
  readonly dernierMouvementLe: string;
  /** Renseigné UNIQUEMENT pour `statut = 'sorti'` (RPP-05). */
  readonly motifSortie: MotifSortieDepotPneus | null;
  /** Traçabilité RPP-03 : la ligne d'OR qui a réalisé le DERNIER changement de saison. */
  readonly ligneOrDernierChangementId: string | null;
  readonly creeLe: string;
  readonly modifieLe: string;
}

/* ------------------------------------------------------------------ */
/* Lecture — collections                                               */
/* ------------------------------------------------------------------ */

export const TRIS_DEPOTS_PNEUS = [
  'dernierMouvementLe:desc',
  'dernierMouvementLe:asc',
  'entreLe:desc',
  'entreLe:asc',
] as const;
export const TRI_DEFAUT_DEPOTS_PNEUS = 'dernierMouvementLe:desc';

/** `GET /sites/{siteId}/hangar-pneus` — vue hangar (spec §5, §6) : jeux du site, filtrables par
 *  statut/saison. `siteId` vient du chemin, jamais de ce schéma. */
export const schemaFiltresHangarPneus = schemaParametresPage.extend({
  statut: schemaListeQuery(z.enum(STATUTS_DEPOT_PNEUS)).optional(),
  saison: z.enum(SAISONS_PNEU).optional(),
  tri: z.enum(TRIS_DEPOTS_PNEUS).default(TRI_DEFAUT_DEPOTS_PNEUS),
});
export type FiltresHangarPneus = z.infer<typeof schemaFiltresHangarPneus>;

/** `GET /vehicules/{id}/depots-pneus` — historique COMPLET d'un véhicule, tous statuts
 *  confondus (`sorti` compris — RPP-05 : jamais supprimé, doit rester consultable). */
export const schemaFiltresDepotsPneusVehicule = schemaParametresPage.extend({
  statut: schemaListeQuery(z.enum(STATUTS_DEPOT_PNEUS)).optional(),
  tri: z.enum(['entreLe:desc', 'entreLe:asc'] as const).default('entreLe:desc'),
});
export type FiltresDepotsPneusVehicule = z.infer<typeof schemaFiltresDepotsPneusVehicule>;

/** `GET /depots-pneus/a-relancer` — jeux oubliés (RPP-04), site ou tenant entier. */
export const schemaFiltresARelancerPneus = schemaParametresPage.extend({
  siteId: schemaIdentifiant.optional(),
  tri: z
    .enum(['dernierMouvementLe:desc', 'dernierMouvementLe:asc'] as const)
    .default('dernierMouvementLe:asc'),
});
export type FiltresARelancerPneus = z.infer<typeof schemaFiltresARelancerPneus>;

/* ------------------------------------------------------------------ */
/* Écriture — création + deux actions nommées                         */
/* ------------------------------------------------------------------ */

/**
 * `POST /vehicules/{id}/depots-pneus` — entrée d'un jeu en dépôt (`vehiculeId` vient du chemin).
 * `Idempotency-Key` OBLIGATOIRE : création sensible (garde physique d'un bien du client).
 * Refusé (`409 CONFLIT`, RPP-02) si un jeu `en_depot`/`monte` existe déjà pour ce véhicule et
 * cette saison. `dimension` omis → recopié par le SERVEUR depuis `vehicule.pneusEte`/`pneusHiver`
 * selon `saison` (spec §4.3) ; le CLIENT peut aussi la fournir explicitement (pneus non
 * d'origine).
 */
export const schemaCreationDepotPneus = z
  .object({
    siteId: schemaIdentifiant,
    saison: z.enum(SAISONS_PNEU),
    codeCase: schemaCodeCase.nullish(),
    dimension: schemaCodeCase.nullish(),
    etat: z.string().trim().max(500).nullish(),
  })
  .strict();
export type EntreeCreationDepotPneus = z.infer<typeof schemaCreationDepotPneus>;

/**
 * `POST /depots-pneus/{id}/changer-saison` — RPP-03 : événement métier qui inverse les statuts
 * (`monte` ↔ `en_depot`) du jeu visé ET de son jeu jumeau (même véhicule, saison opposée, statut
 * actif) s'il existe. `ligneOrId` facultatif : la ligne d'OR qui a réalisé le changement.
 * Pas d'`Idempotency-Key` — transition gardée par l'état de départ, même doctrine que
 * `reservations/{id}/satisfaire` (rejeu sur un jeu déjà transitionné échoue proprement en 409).
 */
export const schemaChangementSaisonDepotPneus = z
  .object({
    ligneOrId: schemaIdentifiant.nullish(),
  })
  .strict();
export type EntreeChangementSaisonDepotPneus = z.infer<typeof schemaChangementSaisonDepotPneus>;

/**
 * `POST /depots-pneus/{id}/sortir` — RPP-05 : statut TERMINAL, motif obligatoire. Jamais une
 * suppression de ligne. Refusé (`409 CONFLIT`) si le jeu est déjà `sorti`.
 */
export const schemaSortieDepotPneus = z
  .object({
    motif: z.enum(MOTIFS_SORTIE_DEPOT_PNEUS),
  })
  .strict();
export type EntreeSortieDepotPneus = z.infer<typeof schemaSortieDepotPneus>;

/**
 * `POST /depots-pneus/{id}/deplacer` — DÉFAUT CORRIGÉ : `codeCase` (RPP-07) n'était modifiable
 * qu'à la création (`POST /vehicules/{id}/depots-pneus`), jamais ensuite. Or dans un hangar, les
 * jeux de pneus se déplacent d'une case à l'autre — c'est le geste courant, pas l'exception.
 * `codeCase` nullish : accepte aussi bien un nouveau repère qu'un retrait (case libérée sans
 * repère connu). Refusé (`409 CONFLIT`) sur un dépôt déjà `sorti` (RPP-05, statut TERMINAL — un
 * bien qui a quitté la garde du garage n'a plus de repère de rangement à tenir à jour).
 */
export const schemaDeplacementDepotPneus = z
  .object({
    codeCase: schemaCodeCase.nullish(),
  })
  .strict();
export type EntreeDeplacementDepotPneus = z.infer<typeof schemaDeplacementDepotPneus>;
