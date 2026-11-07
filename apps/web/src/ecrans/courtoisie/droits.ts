import type { RoleUtilisateur } from '@dfa/shared';

/** Miroir d'affichage de `courtoisie.preter` (`matrice-droits.ts`) : comptoir et au-dessus. */
const ROLES_PRETER: ReadonlySet<RoleUtilisateur> = new Set([
  'receptionnaire',
  'chef_atelier',
  'direction',
  'admin',
]);

/** Miroir d'affichage de `courtoisie.parc.gerer` : chef d'atelier, direction, admin. */
const ROLES_GERER_PARC: ReadonlySet<RoleUtilisateur> = new Set([
  'chef_atelier',
  'direction',
  'admin',
]);

export const peutPreterCourtoisie = (role: RoleUtilisateur | undefined): boolean =>
  role !== undefined && ROLES_PRETER.has(role);

export const peutGererParcCourtoisie = (role: RoleUtilisateur | undefined): boolean =>
  role !== undefined && ROLES_GERER_PARC.has(role);
