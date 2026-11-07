import type { RoleUtilisateur } from '@dfa/shared';

/**
 * Miroir CÔTÉ FRONT de `facturation.export.creer` (`apps/api/src/auth/matrice-droits.ts`,
 * `DROITS_EXPORT_COMPTABLE_PAR_ROLE`) : `direction` et `comptable` seuls, `admin` exclu (RF-115).
 * Ergonomie, pas sécurité : le serveur reste l'arbitre. Un rôle sans droit ne voit pas le bouton.
 */
const ROLES_EXPORT_FIDUCIAIRE: ReadonlySet<RoleUtilisateur> = new Set(['direction', 'comptable']);

export function peutExporterVersFiduciaire(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_EXPORT_FIDUCIAIRE.has(role);
}
