import type { RoleUtilisateur } from '@dfa/shared';

/** Clé i18n (namespace `commun`) pour chaque rôle. Mapping explicite et exhaustif — jamais de
 *  conversion dynamique snake_case -> camelCase, pour que `tsc` signale l'oubli d'un rôle si
 *  `RoleUtilisateur` évolue. */
const CLES_TRADUCTION_ROLE: Readonly<Record<RoleUtilisateur, string>> = {
  admin: 'commun:roles.admin',
  direction: 'commun:roles.direction',
  vendeur: 'commun:roles.vendeur',
  receptionnaire: 'commun:roles.receptionnaire',
  chef_atelier: 'commun:roles.chefAtelier',
  technicien: 'commun:roles.technicien',
  magasinier: 'commun:roles.magasinier',
  comptable: 'commun:roles.comptable',
};

export function cleTraductionRole(role: RoleUtilisateur): string {
  return CLES_TRADUCTION_ROLE[role];
}
