import type { RoleUtilisateur } from '@dfa/shared';

/**
 * Gouvernance de l'agenda de rendez-vous — DUPLIQUÉE depuis `apps/api/src/auth/matrice-droits.ts`
 * (`DROITS_RENDEZ_VOUS_PAR_ROLE`), jamais importée depuis `apps/api` (frontière tenant/serveur,
 * jamais franchie — même doctrine que `ecrans/accueil/droits.ts`, `ecrans/pneus/droits.ts`).
 *
 * Trois périmètres RÉELS (§ message du coordinateur, vérifiés dans la matrice) :
 *  - LECTURE (`rendez_vous.lire`) : réceptionniste, chef d'atelier, direction, admin, technicien.
 *  - CRÉATION (`rendez_vous.creer`) : réceptionniste, direction, admin SEULS — le chef d'atelier
 *    « les voit et les réorganise », il ne les prend pas au téléphone (brief métier).
 *  - CYCLE DE VIE (modifier/arrivée/absence/annulation) : réceptionniste, chef d'atelier, direction,
 *    admin — le technicien en est exclu, lecture seule stricte.
 *
 * Un geste proposé à qui n'y a pas droit est pire que pas de geste (consigne du coordinateur) : ces
 * fonctions MASQUENT, elles ne désactivent jamais.
 */
const ROLES_LECTURE_RENDEZ_VOUS: readonly RoleUtilisateur[] = [
  'receptionnaire',
  'chef_atelier',
  'direction',
  'admin',
  'technicien',
];

const ROLES_CREATION_RENDEZ_VOUS: readonly RoleUtilisateur[] = [
  'receptionnaire',
  'direction',
  'admin',
];

const ROLES_ACTION_RENDEZ_VOUS: readonly RoleUtilisateur[] = [
  'receptionnaire',
  'chef_atelier',
  'direction',
  'admin',
];

export function peutLireRendezVous(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_LECTURE_RENDEZ_VOUS.includes(role);
}

/** Bouton « Nouveau rendez-vous », et création depuis les trois points d'entrée de l'Écran 2. */
export function peutCreerRendezVous(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_CREATION_RENDEZ_VOUS.includes(role);
}

/** Le véhicule est arrivé / Signaler l'absence / Annuler — Écran 3. */
export function peutAgirSurRendezVous(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_ACTION_RENDEZ_VOUS.includes(role);
}
