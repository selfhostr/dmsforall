import type { RoleUtilisateur } from '@dfa/shared';

/**
 * Gouvernance du hangar à pneus — DUPLIQUÉE depuis `apps/api/src/pneus/droits-provisoires.ts`,
 * jamais importée depuis `apps/api` (frontière tenant/serveur, jamais franchie — même règle que
 * `ecrans/pieces/droits.ts`). Droits PROVISOIRES côté API elle-même (`@AucunDroitRequis()` +
 * vérification en service, `pneus.depot.*` n'existe pas encore dans `auth/matrice-droits.ts`) :
 * un défensif d'ERGONOMIE ici, pas la seule ligne de défense — un rôle sans le droit qui
 * soumettrait quand même une action reçoit un `403 DROIT_INSUFFISANT` géré normalement (bandeau
 * générique via `messageErreur`).
 *
 * Les DEUX listes ci-dessous sont recopiées LITTÉRALEMENT de `droits-provisoires.ts` (mêmes rôles,
 * même ordre) : si `expert-auth` fait évoluer `ROLES_PNEUS_DEPOT_LECTURE`/`_ECRITURE` côté API,
 * cette copie doit être mise à jour au même moment — même dette assumée que la duplication
 * `ROLES_PIECES` (`routes/droits-routes.ts`) vis-à-vis de `DROITS_PIECES_PAR_ROLE`.
 */

/** Lecture (`GET .../hangar-pneus`, `.../depots-pneus`, `.../a-relancer`) : tout rôle de PERSONNE,
 *  `poste_atelier` EXCLU (borne murale, aucune utilité au hangar à pneus). */
const ROLES_LECTURE_DEPOT_PNEUS: ReadonlySet<RoleUtilisateur> = new Set([
  'admin',
  'direction',
  'vendeur',
  'receptionnaire',
  'chef_atelier',
  'technicien',
  'magasinier',
  'comptable',
]);

/** Écriture (`POST .../depots-pneus`, `.../changer-saison`, `.../sortir`) : les rôles qui
 *  manipulent physiquement un jeu ou reçoivent le véhicule. `comptable` et `vendeur` EXCLUS. */
const ROLES_ECRITURE_DEPOT_PNEUS: ReadonlySet<RoleUtilisateur> = new Set([
  'admin',
  'direction',
  'receptionnaire',
  'chef_atelier',
  'technicien',
  'magasinier',
]);

export function peutLireDepotPneus(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_LECTURE_DEPOT_PNEUS.has(role);
}

export function peutGererDepotPneus(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_ECRITURE_DEPOT_PNEUS.has(role);
}

/** Même liste que `ROLES_LECTURE_DEPOT_PNEUS` ci-dessus, exportée sous forme de TABLEAU pour
 *  `routes/droits-routes.ts`/`composants/layout/BarreLaterale.tsx` (`Array.includes`, même
 *  interface que `ROLES_PIECES`/`ROLES_VENTES`) — deux formes pour deux usages, pas deux sources
 *  de vérité : celle-ci DÉRIVE de `ROLES_LECTURE_DEPOT_PNEUS`, jamais une troisième liste tapée à
 *  la main. */
export const ROLES_PNEUS: readonly RoleUtilisateur[] = [...ROLES_LECTURE_DEPOT_PNEUS];
