import type { RoleUtilisateur } from '@dfa/shared';

import { peut, type ActionsSession } from '@/droits';

/** Widget calendrier de l'écran « Aujourd'hui » : lire les OR (droit lu dans `session.actions`). */
export const peutLireEcheancesOr = (a: ActionsSession) => peut(a, 'atelier.or.lire');

/**
 * GABARIT d'accueil (pas un droit) : quel tableau de bord s'affiche suit le rôle d'origine de la
 * personne (préréglage), chaque ACTION restant gouvernée par son droit propre (`session.actions`).
 * Rôles « de bureau » : l'accueil commence par la recherche et les actions rapides.
 */
export const ROLES_ACCUEIL_BUREAU: readonly RoleUtilisateur[] = [
  'direction',
  'receptionnaire',
  'chef_atelier',
  'comptable',
];

/** Le bloc « à faire aujourd'hui » : tout le bureau sauf le comptable, dont le tableau de bord
 *  porte déjà les factures à encaisser et à relancer. */
export const ROLES_A_FAIRE_AUJOURDHUI: readonly RoleUtilisateur[] = [
  'direction',
  'receptionnaire',
  'chef_atelier',
];

export function estRoleAccueilBureau(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_ACCUEIL_BUREAU.includes(role);
}

export function voitAFaireAujourdhui(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_A_FAIRE_AUJOURDHUI.includes(role);
}
