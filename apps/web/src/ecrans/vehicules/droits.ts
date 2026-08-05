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
