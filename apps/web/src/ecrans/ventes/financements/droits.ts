import type { RoleUtilisateur } from '@dfa/shared';

/**
 * Gouvernance du financement (étape 4, ventes) — DUPLIQUÉE ici depuis
 * `apps/api/src/auth/matrice-droits.ts` (bloc `DROITS_VENTES_PAR_ROLE`), même règle que
 * `ecrans/ventes/reprises/droits.ts` (frontière tenant/serveur jamais franchie).
 */

/** Lecture financement : direction, comptable, vendeur, receptionnaire. */
const ROLES_LECTURE_FINANCEMENT: ReadonlySet<RoleUtilisateur> = new Set([
  'direction',
  'comptable',
  'vendeur',
  'receptionnaire',
]);

/** Création d'une proposition de financement (§11 ligne 7, étendu) : `direction`, `vendeur`
 *  seulement — `comptable` NE reçoit PAS `ventes.financement.creer` côté matrice API (seulement
 *  `confirmer`/`refuser`, ci-dessous). */
const ROLES_CREATION_FINANCEMENT: ReadonlySet<RoleUtilisateur> = new Set(['direction', 'vendeur']);

/** Confirmer/refuser un financement (§11 ligne 7, littéral) : `direction`, `vendeur`, `comptable`. */
const ROLES_CONFIRMATION_FINANCEMENT: ReadonlySet<RoleUtilisateur> = new Set([
  'direction',
  'vendeur',
  'comptable',
]);

export function peutLireFinancement(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_LECTURE_FINANCEMENT.has(role);
}

export function peutCreerFinancement(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_CREATION_FINANCEMENT.has(role);
}

/** Couvre `confirmer` ET `refuser` — même droit côté matrice pour les deux (`ECRITURE_FINANCEMENT`
 *  regroupe `creer`/`confirmer`/`refuser` pour `direction`/`vendeur` ; `comptable` reçoit
 *  `confirmer`/`refuser` seuls, ajoutés explicitement à côté de la lecture). */
export function peutConfirmerOuRefuserFinancement(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_CONFIRMATION_FINANCEMENT.has(role);
}
