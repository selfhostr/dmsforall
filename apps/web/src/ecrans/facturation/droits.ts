import type { RoleUtilisateur } from '@dfa/shared';

/**
 * Gouvernance de la visibilité des montants en facturation — miroir CÔTÉ FRONT de
 * `ROLES_SANS_MONTANT_FACTURATION` (`apps/api/src/facturation/documents/mappeurs.ts`, RF-115/
 * RF-116) : `ROLES_SANS_MONTANT` partagé (`technicien`, `poste_atelier`,
 * `apps/api/src/auth/matrice-droits.ts`) PLUS `admin` — exclusion DÉLIBÉRÉE et PROPRE À LA
 * FACTURATION (séparation des pouvoirs : qui peut créer des comptes ne doit pas voir les
 * montants), à la différence de la doctrine générale de l'étape 1 où `admin` est un superset de
 * `direction`. PAS un oubli, jamais à combler par copier-coller d'un autre rôle — même tension déjà
 * tranchée ainsi par le module paiements (voir le commentaire de `mappeurs.ts`).
 *
 * Même doctrine que `ecrans/tableau-bord/droits.ts`/`ecrans/pieces/droits.ts` : un défensif
 * d'ERGONOMIE, pas la seule ligne de défense. Le serveur masque déjà `dateEcheance`/`enRetard`/
 * `joursRetard`/`totalTtcCentimes`/etc. (champs `?:` absents, jamais `null`/`0`) — un rôle sans
 * droit qui lirait quand même la réponse verrait ces champs `undefined`, quoi qu'il arrive. Cette
 * garde sert uniquement à ne pas construire une colonne "Retard" structurellement vide (en-tête
 * compris) à l'écran, pas à protéger une donnée qui ne l'est déjà pas.
 */
const ROLES_SANS_MONTANT_FACTURATION: ReadonlySet<RoleUtilisateur> = new Set([
  'technicien',
  'poste_atelier',
  'admin',
]);

export function peutVoirMontantsFacturation(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && !ROLES_SANS_MONTANT_FACTURATION.has(role);
}
