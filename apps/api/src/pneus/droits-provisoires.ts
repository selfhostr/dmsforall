import type { RoleUtilisateur } from '@dfa/shared';

import { ErreurMetier } from '../common/erreurs';

/**
 * PALLIATIF TEMPORAIRE — `apps/api/src/pneus/**` (périmètre d'écriture de ce module) n'a PAS
 * accès en écriture à `apps/api/src/auth/matrice-droits.ts` (propriété d'un autre agent). Les
 * trois actions proposées par la spécification (`docs/specification-parc-et-hangar-pneus.md`
 * §5) n'existent donc pas encore :
 *   - `pneus.depot.lire`
 *   - `pneus.depot.creer`
 *   - `pneus.depot.gerer`   (changement de saison, sortie)
 *
 * MÊME SITUATION, MÊME SOLUTION que celle déjà éprouvée dans ce dépôt pour le bloc créancier et
 * pour `tableau-bord/` (voir `apps/api/src/tableau-bord/droits-provisoires.ts`, en-tête) : les
 * routes portent `@AucunDroitRequis()` (authentifié suffit pour passer `GardeDroit`,
 * `common/droits/garde-droit.ts`) et la vérification RÉELLE du rôle est faite ICI, en service,
 * AVANT toute lecture ou écriture de données — jamais un accès ouvert à tout rôle authentifié en
 * attendant que la matrice soit mise à jour. `verifierRoleAutorise` est appelée en tout DÉBUT de
 * chaque méthode de `ServiceDepotPneus`, avant tout appel à `AccesBase.enTenant`.
 *
 * À FAIRE PAR expert-auth quand `matrice-droits.ts` est accessible à cette tâche : ajouter les
 * trois actions ci-dessus à `TOUTES_ACTIONS`, deux blocs `DROITS_PNEUS_DEPOT_*_PAR_ROLE` (mêmes
 * rôles qu'ici, EXACTEMENT), les fusionner dans `MATRICE_DROITS`, puis dans CE module :
 * remplacer `@AucunDroitRequis()` par `@ExigerDroit('pneus.depot.lire' | 'creer' | 'gerer')` sur
 * les routes correspondantes de `depot-pneus.controller.ts`, et supprimer les appels à
 * `verifierRoleAutorise` (devenus redondants avec `GardeDroit`).
 */

/**
 * Lecture (`GET /sites/{siteId}/hangar-pneus`, `GET /vehicules/{id}/depots-pneus`,
 * `GET /depots-pneus/a-relancer`) : ouverte à tout rôle de PERSONNE qui peut avoir besoin de
 * retrouver un jeu de pneus — même doctrine que `ROLES_TABLEAU_BORD_ACTIVITE`
 * (`tableau-bord/droits-provisoires.ts`) : « la lecture est ouverte par défaut, seule l'écriture
 * est gouvernée » (doctrine de tête de `auth/matrice-droits.ts`).
 *
 * `poste_atelier` EXCLU : borne murale de l'atelier, périmètre construit par énumération et
 * limité à l'identification PIN/pointage (voir `ROLES_TABLEAU_BORD_ACTIVITE`) — le hangar à
 * pneus n'a aucune utilité à sa fonction.
 */
export const ROLES_PNEUS_DEPOT_LECTURE: readonly RoleUtilisateur[] = [
  'admin',
  'direction',
  'vendeur',
  'receptionnaire',
  'chef_atelier',
  'technicien',
  'magasinier',
  'comptable',
];

/**
 * Écriture (`POST .../depots-pneus`, `.../changer-saison`, `.../sortir`) : les rôles qui
 * manipulent PHYSIQUEMENT un jeu de pneus ou reçoivent le véhicule — magasinier (dépôt/hangar),
 * technicien (change lui-même les pneus), réceptionnaire/chef d'atelier (accueil du véhicule),
 * direction/admin (supervision). `comptable` et `vendeur` EXCLUS : aucun geste physique sur un
 * jeu de pneus ne relève de leur fonction. Un seul jeu de rôles pour `creer`/`gerer` à ce stade
 * (pas de distinction fine avant que `matrice-droits.ts` ne porte les deux actions séparément —
 * signalé ci-dessus, décision de granularité laissée à expert-auth).
 */
export const ROLES_PNEUS_DEPOT_ECRITURE: readonly RoleUtilisateur[] = [
  'admin',
  'direction',
  'receptionnaire',
  'chef_atelier',
  'technicien',
  'magasinier',
];

/** Lève `403 DROIT_INSUFFISANT` si `role` n'est pas dans `rolesAutorises` — voir l'en-tête de ce
 *  fichier : appelée en tout début de service, AVANT tout accès base. */
export function verifierRoleAutorise(
  role: RoleUtilisateur,
  rolesAutorises: readonly RoleUtilisateur[],
  nomAction: string,
): void {
  if (!rolesAutorises.includes(role)) {
    throw new ErreurMetier(
      'DROIT_INSUFFISANT',
      `Le rôle "${role}" n'a pas accès à "${nomAction}".`,
    );
  }
}
