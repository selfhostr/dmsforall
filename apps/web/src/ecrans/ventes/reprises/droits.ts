import type { RoleUtilisateur } from '@dfa/shared';

/**
 * Gouvernance de la reprise (étape 4, ventes) — DUPLIQUÉE ici depuis
 * `apps/api/src/auth/matrice-droits.ts` (bloc `DROITS_VENTES_PAR_ROLE`), jamais importée depuis
 * `apps/api` (frontière tenant/serveur jamais franchie, même règle que `ecrans/pieces/droits.ts`).
 * Défensif d'ERGONOMIE seulement : le serveur reste l'arbitre final (`403 DROIT_INSUFFISANT`).
 *
 * §11 de `docs/specification-etape-4-ventes.md` (lignes 720-730) + inférences documentées côté
 * API : `admin`, `technicien`, `magasinier` n'ont AUCUN droit `ventes.*` (`[]` littéral, RF-115
 * repris pour ce domaine) — jamais comblé par copier-coller d'un autre rôle.
 */

/** Lecture reprise : direction, comptable, vendeur, receptionnaire. PAS `chef_atelier` (lecture
 *  minimale du domaine ventes, `vehicule_stock.lire`/`dossier.lire` seulement — détail financier
 *  sans besoin opérationnel identifié côté API). */
const ROLES_LECTURE_REPRISE: ReadonlySet<RoleUtilisateur> = new Set([
  'direction',
  'comptable',
  'vendeur',
  'receptionnaire',
]);

/** Création/modification/négociation (§11 ligne 3) : `vendeur`, `direction` seuls. */
const ROLES_ECRITURE_REPRISE: ReadonlySet<RoleUtilisateur> = new Set(['direction', 'vendeur']);

/** Refus (le client garde son véhicule) : même périmètre que la négociation — décision
 *  commerciale courante, pas une correction exceptionnelle. */
const ROLES_REFUS_REPRISE: ReadonlySet<RoleUtilisateur> = new Set(['direction', 'vendeur']);

/** `confirmer` — correction exceptionnelle (normalement effet de bord de `dossier.engager`) :
 *  `direction` SEULE. */
const ROLES_CONFIRMATION_REPRISE: ReadonlySet<RoleUtilisateur> = new Set(['direction']);

export function peutLireReprise(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_LECTURE_REPRISE.has(role);
}

export function peutEcrireReprise(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_ECRITURE_REPRISE.has(role);
}

export function peutRefuserReprise(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_REFUS_REPRISE.has(role);
}

export function peutConfirmerReprise(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_CONFIRMATION_REPRISE.has(role);
}
