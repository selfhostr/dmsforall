import type { RoleUtilisateur } from '@dfa/shared';

/**
 * Gouvernance du paramétrage atelier et des référentiels (taux horaires, prestations) —
 * `INFERE_PARAMETRAGE_GOUVERNANCE` (`apps/api/src/auth/matrice-droits.ts`) : `parametrage.
 * atelier.modifier`/`parametrage.referentiel.modifier` ne sont accordés qu'à `chef_atelier` et
 * `direction`. La LECTURE (`*.lire`), elle, est ouverte à tout rôle authentifié — ces écrans
 * restent donc toujours visibles, seules les actions d'écriture se grisent.
 *
 * Dupliqué ici plutôt qu'importé depuis `apps/api` (frontière tenant/serveur, jamais franchie) —
 * un défensif, pas la seule ligne de défense : un rôle sans le droit qui parviendrait quand même
 * à soumettre un formulaire reçoit un `403 DROIT_INSUFFISANT` géré normalement par les dialogues
 * (bandeau d'erreur générique via `messageErreur`).
 */
const ROLES_GOUVERNANCE_PARAMETRAGE: ReadonlySet<RoleUtilisateur> = new Set([
  'chef_atelier',
  'direction',
]);

export function peutModifierParametrage(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_GOUVERNANCE_PARAMETRAGE.has(role);
}
