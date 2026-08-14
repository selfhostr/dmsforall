import type { RoleUtilisateur } from '@dfa/shared';

/**
 * Gouvernance de l'écriture véhicule (`PATCH /vehicules/{id}`, action `vehicule.modifier`) —
 * DUPLIQUÉE ici depuis `apps/api/src/auth/matrice-droits.ts` (`L960_VEHICULE_ECRITURE`, composé
 * dans `DROITS_RECEPTIONNAIRE`, `DROITS_CHEF_ATELIER` — qui étend `DROITS_RECEPTIONNAIRE` —,
 * `DROITS_DIRECTION`/`DROITS_ADMIN` — qui étendent `DROITS_CHEF_ATELIER` — et `DROITS_MAGASINIER`
 * explicitement), jamais importée depuis `apps/api` (frontière tenant/serveur, jamais franchie —
 * même règle que `ecrans/pieces/droits.ts`/`ecrans/pneus/droits.ts`). Défensif d'ERGONOMIE, pas
 * la seule ligne de défense : un rôle sans le droit qui soumettrait quand même `PATCH
 * /vehicules/{id}` reçoit un `403 DROIT_INSUFFISANT` géré normalement (bandeau générique via
 * `messageErreur`) — le serveur reste l'arbitre final.
 *
 * `technicien`, `comptable`, `vendeur` et `poste_atelier` n'ont QUE `vehicule.lire` côté API
 * (`LECTURE_ETENDUE`) — EXCLUS ci-dessous, littéralement, jamais comblés par copier-coller d'un
 * autre groupe de rôles.
 */
const ROLES_ECRITURE_VEHICULE: ReadonlySet<RoleUtilisateur> = new Set([
  'admin',
  'direction',
  'receptionnaire',
  'chef_atelier',
  'magasinier',
]);

export function peutModifierVehicule(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_ECRITURE_VEHICULE.has(role);
}

/**
 * Gouvernance de la gestion de plaque (`POST /vehicules/{id}/plaques`, action
 * `vehicule.plaque.gerer`) — DUPLIQUÉE depuis `apps/api/src/auth/matrice-droits.ts`
 * (`INFERE_VEHICULE_GESTION`), même doctrine que `peutModifierVehicule` ci-dessus. PAS le même
 * ensemble de rôles : le magasinier a `vehicule.modifier` (§10 L960) mais PAS
 * `vehicule.plaque.gerer` (action de comptoir/atelier, alignée sur « changer le détenteur ») — un
 * dialogue qui gate ses deux gestes avec `peutModifierVehicule` seul afficherait un champ plaque
 * que le magasinier ne peut pas soumettre (403 rendu comme une saisie perdue, pas comme un refus
 * de droit clair).
 */
const ROLES_GESTION_PLAQUE_VEHICULE: ReadonlySet<RoleUtilisateur> = new Set([
  'admin',
  'direction',
  'receptionnaire',
  'chef_atelier',
]);

export function peutGererPlaqueVehicule(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_GESTION_PLAQUE_VEHICULE.has(role);
}
