import type { RoleUtilisateur } from '@dfa/shared';

/**
 * Clé i18n (namespace `commun`) pour chaque rôle. Mapping explicite et exhaustif — jamais de
 * conversion dynamique snake_case -> camelCase, pour que `tsc` signale l'oubli d'un rôle si
 * `RoleUtilisateur` évolue.
 *
 * `poste_atelier` (compte de service, voir `ROLES_COMPTE_DE_SERVICE` dans `@dfa/shared`) EST
 * inclus ici : cette table sert à afficher le libellé du rôle du compte DE LA SESSION EN COURS
 * (`MenuUtilisateur`, via `session.utilisateur.role: RoleUtilisateur`), pas à peupler un
 * sélecteur d'autres rôles assignables. Une borne d'atelier connectée passe par le même en-tête
 * applicatif qu'un compte de personne (aucun layout dédié à ce jour) et a donc besoin, comme tout
 * compte, d'un libellé pour son propre rôle. À ne PAS confondre avec une future liste de rôles
 * proposés à la sélection (ex. formulaire de création d'utilisateur) : celle-là doit s'appuyer sur
 * `RolePersonne`/`ROLES_PERSONNE` (`@dfa/shared`), qui exclut structurellement les comptes de
 * service.
 */
const CLES_TRADUCTION_ROLE: Readonly<Record<RoleUtilisateur, string>> = {
  admin: 'commun:roles.admin',
  direction: 'commun:roles.direction',
  vendeur: 'commun:roles.vendeur',
  receptionnaire: 'commun:roles.receptionnaire',
  chef_atelier: 'commun:roles.chefAtelier',
  technicien: 'commun:roles.technicien',
  magasinier: 'commun:roles.magasinier',
  comptable: 'commun:roles.comptable',
  poste_atelier: 'commun:roles.posteAtelier',
};

export function cleTraductionRole(role: RoleUtilisateur): string {
  return CLES_TRADUCTION_ROLE[role];
}
