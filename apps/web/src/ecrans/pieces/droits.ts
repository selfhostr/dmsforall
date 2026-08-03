import type { RoleUtilisateur } from '@dfa/shared';

/**
 * Gouvernance du module pièces — DUPLIQUÉE ici depuis `apps/api/src/auth/matrice-droits.ts`
 * (bloc `DROITS_PIECES_PAR_ROLE`), jamais importée depuis `apps/api` (frontière tenant/serveur,
 * jamais franchie — même règle que `ecrans/parametrage/droits.ts`). Un défensif d'ERGONOMIE, pas
 * la seule ligne de défense : un rôle sans le droit qui parviendrait quand même à soumettre une
 * action reçoit un `403 DROIT_INSUFFISANT` géré normalement (bandeau d'erreur générique via
 * `messageErreur`) — le serveur reste l'arbitre final.
 *
 * RF-115 : `admin` n'a AUCUN droit `pieces.*` (bloc entier `[]`, littéral, jamais comblé par
 * copier-coller d'un autre rôle) — voir `routes/droits-routes.ts` (`ROLES_PIECES`), qui restreint
 * l'ATTEINTE des routes de ce module sur cette base : contrairement à `parametrage.referentiel.*`
 * (ouvert à tous), la LECTURE elle-même est fermée à `admin` ici, donc une garde de route reflète
 * une restriction RÉELLE de l'API plutôt que d'en inventer une.
 */

/** §11 « Créer/modifier un article » : direction, chef_atelier, magasinier. */
const ROLES_ECRITURE_ARTICLE: ReadonlySet<RoleUtilisateur> = new Set(['direction', 'chef_atelier', 'magasinier']);

/** Inféré — réglages de stock par site (emplacement/seuils, PP-08) : même périmètre que
 *  l'écriture article (donnée de référentiel). */
const ROLES_ECRITURE_STOCK_SITE: ReadonlySet<RoleUtilisateur> = new Set(['direction', 'chef_atelier', 'magasinier']);

/** §11 « Enregistrer une entrée/sortie », « Réceptionner », « Faire l'inventaire » : `magasinier`
 *  SEUL, de façon ferme. */
const ROLES_ECRITURE_MOUVEMENT: ReadonlySet<RoleUtilisateur> = new Set(['magasinier']);

/** §11 « Enregistrer une sortie » (satisfaire une réservation) : même périmètre que les
 *  mouvements, `magasinier` seul. */
const ROLES_SATISFACTION_RESERVATION: ReadonlySet<RoleUtilisateur> = new Set(['magasinier']);

/** §11 « Libérer une réservation active » : direction, chef_atelier, magasinier. */
const ROLES_LIBERATION_RESERVATION: ReadonlySet<RoleUtilisateur> = new Set(['direction', 'chef_atelier', 'magasinier']);

export function peutEcrireArticle(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_ECRITURE_ARTICLE.has(role);
}

export function peutEcrireStockSite(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_ECRITURE_STOCK_SITE.has(role);
}

export function peutCreerMouvement(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_ECRITURE_MOUVEMENT.has(role);
}

export function peutSatisfaireReservation(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_SATISFACTION_RESERVATION.has(role);
}

export function peutLibererReservation(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_LIBERATION_RESERVATION.has(role);
}
