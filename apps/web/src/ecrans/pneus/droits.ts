import type { RoleUtilisateur } from '@dfa/shared';

/**
 * Gouvernance du hangar à pneus — DUPLIQUÉE depuis `apps/api/src/auth/matrice-droits.ts`
 * (`LECTURE_PNEUS`/`ENTREE_PNEUS`/`SORTIE_PNEUS`, ~L1693-1733), jamais importée depuis `apps/api`
 * (frontière tenant/serveur, jamais franchie — même règle que `ecrans/pieces/droits.ts`). Les
 * droits `pneus.depot.*` sont DÉFINITIFS côté API — appliqués par `@ExigerDroit(...)` et
 * `GardeDroit` (`apps/api/src/common/droits/garde-droit.ts`), vérifié en exécution (le `403` d'un
 * rôle non habilité vient bien du guard). `apps/api/src/pneus/droits-provisoires.ts` N'EXISTE PLUS
 * — ne pas y renvoyer dans un futur commentaire.
 *
 * Chaque fonction ci-dessous correspond À UNE SEULE action serveur, dans le même découpage que la
 * matrice (pas un booléen unique `peutGérer` qui confondrait des droits différents — défaut corrigé
 * ici, voir le commentaire au-dessus de `ROLES_SORTIE_DEPOT_PNEUS`) :
 *
 *   - `pneus.depot.lire`           → `peutLireDepotPneus`
 *   - `pneus.depot.creer`          → `peutCreerDepotPneus`
 *   - `pneus.depot.changer_saison` → `peutChangerSaisonDepotPneus` ET `peutDeplacerDepotPneus`
 *     (le second gouverne `POST /depots-pneus/{id}/deplacer`, qui porte `@ExigerDroit
 *     ('pneus.depot.changer_saison')` côté contrôleur — PAS un droit `pneus.depot.deplacer`
 *     distinct : « déplacer » un jeu est le même geste physique routinier que « changer de
 *     saison » aux yeux de la matrice, voir `depot-pneus.controller.ts` ~L227-236. Deux fonctions
 *     séparées quand même, pas un alias : si la matrice serveur venait à distinguer les deux droits
 *     un jour, cette copie doit pouvoir suivre sans qu'un site d'appel soit oublié.)
 *   - `pneus.depot.sortir`         → `peutSortirDepotPneus`
 *
 * Ces listes sont recopiées LITTÉRALEMENT de `matrice-droits.ts` (mêmes rôles) : si l'équipe authentification
 * fait évoluer `LECTURE_PNEUS`/`ENTREE_PNEUS`/`SORTIE_PNEUS` côté API, cette copie doit être mise à
 * jour au même moment — même dette assumée que la duplication `ROLES_PIECES`
 * (`routes/droits-routes.ts`) vis-à-vis de `DROITS_PIECES_PAR_ROLE`.
 */

/** `pneus.depot.lire` : les 8 rôles de PERSONNE, `poste_atelier` EXCLU (borne murale, aucune
 *  utilité au hangar à pneus). */
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

/** `pneus.depot.creer` / `pneus.depot.changer_saison` (matrice serveur : `ENTREE_PNEUS`) : les
 *  rôles qui manipulent physiquement un jeu ou reçoivent le véhicule — repris à l'identique du
 *  périmètre d'`atelier.ligne.creer`. `comptable` et `vendeur` EXCLUS : aucun geste physique sur un
 *  jeu de pneus ne relève de leur fonction. */
const ROLES_ENTREE_DEPOT_PNEUS: ReadonlySet<RoleUtilisateur> = new Set([
  'admin',
  'direction',
  'receptionnaire',
  'chef_atelier',
  'technicien',
  'magasinier',
]);

/** `pneus.depot.sortir` (matrice serveur : `SORTIE_PNEUS`) — DÉFAUT CORRIGÉ ici : ce droit est
 *  STRICTEMENT PLUS ÉTROIT que `ROLES_ENTREE_DEPOT_PNEUS` ci-dessus, `technicien` et `magasinier`
 *  EXCLUS. Sortir un jeu clôt la garde du garage sur un bien du client (RPP-05, motif obligatoire,
 *  statut TERMINAL) — décision de comptoir/supervision, pas un geste d'exécution technique, même
 *  périmètre qu'`atelier.or.restituer`. Un seul booléen `peutGérer` couvrant les trois gestes
 *  (`changer_saison`/`déplacer`/`sortir`) faisait voir « Sortir » à un technicien qui ne l'a
 *  jamais eu : le bouton s'affichait, le clic aboutissait à un `403 DROIT_INSUFFISANT` honnête mais
 *  évitable — geste offert puis repris, ce que ce dépôt s'interdit ailleurs (voir la doctrine
 *  posée dans `EcranFicheFacture.tsx` : « un rôle sans droit ne voit pas un bouton grisé, il ne
 *  voit pas de bouton »). */
const ROLES_SORTIE_DEPOT_PNEUS: ReadonlySet<RoleUtilisateur> = new Set([
  'admin',
  'direction',
  'receptionnaire',
  'chef_atelier',
]);

export function peutLireDepotPneus(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_LECTURE_DEPOT_PNEUS.has(role);
}

export function peutCreerDepotPneus(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_ENTREE_DEPOT_PNEUS.has(role);
}

export function peutChangerSaisonDepotPneus(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_ENTREE_DEPOT_PNEUS.has(role);
}

/** Même liste que `peutChangerSaisonDepotPneus` — voir le commentaire de tête du fichier : pas un
 *  alias, une copie qui peut diverger le jour où la matrice serveur distinguerait les deux droits. */
export function peutDeplacerDepotPneus(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_ENTREE_DEPOT_PNEUS.has(role);
}

export function peutSortirDepotPneus(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_SORTIE_DEPOT_PNEUS.has(role);
}

/** Même liste que `ROLES_LECTURE_DEPOT_PNEUS` ci-dessus, exportée sous forme de TABLEAU pour
 *  `routes/droits-routes.ts`/`composants/layout/BarreLaterale.tsx` (`Array.includes`, même
 *  interface que `ROLES_PIECES`/`ROLES_VENTES`) — deux formes pour deux usages, pas deux sources
 *  de vérité : celle-ci DÉRIVE de `ROLES_LECTURE_DEPOT_PNEUS`, jamais une troisième liste tapée à
 *  la main. */
export const ROLES_PNEUS: readonly RoleUtilisateur[] = [...ROLES_LECTURE_DEPOT_PNEUS];
