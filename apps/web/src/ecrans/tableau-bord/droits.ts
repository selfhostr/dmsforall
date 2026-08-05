import type { RoleUtilisateur } from '@dfa/shared';

/**
 * Gouvernance du tableau de bord — DUPLIQUÉE ici depuis `apps/api/src/tableau-bord/
 * droits-provisoires.ts` (frontière tenant/serveur jamais franchie, même doctrine que
 * `ecrans/pieces/droits.ts`) : un défensif d'ERGONOMIE, pas la seule ligne de défense. Un rôle
 * sans le droit qui atteindrait quand même l'endpoint reçoit un `403 DROIT_INSUFFISANT` géré
 * normalement côté écran — le serveur reste l'arbitre final.
 *
 * `GET /tableau-bord/activite` : ouvert à tout rôle de PERSONNE sauf `poste_atelier` (la borne
 * murale partagée n'a pas d'usage tableau de bord).
 */
export const ROLES_TABLEAU_BORD_ACTIVITE: readonly RoleUtilisateur[] = [
  'technicien',
  'magasinier',
  'vendeur',
  'receptionnaire',
  'chef_atelier',
  'comptable',
  'direction',
  'admin',
];

/**
 * `GET /tableau-bord/financier` : RÉSERVÉ `direction`/`comptable` SEULEMENT — RF-115, `admin`
 * explicitement EXCLU (séparation des pouvoirs délibérée, PAS un oubli à corriger). Ne jamais
 * ajouter `admin` à cette liste par copier-coller d'un autre groupe de rôles.
 */
export const ROLES_TABLEAU_BORD_FINANCIER: readonly RoleUtilisateur[] = ['direction', 'comptable'];

export function peutVoirActiviteTableauBord(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_TABLEAU_BORD_ACTIVITE.includes(role);
}

export function peutVoirFinancierTableauBord(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_TABLEAU_BORD_FINANCIER.includes(role);
}
