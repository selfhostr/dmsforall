import type { RoleUtilisateur } from '@dfa/shared';

import { ROLES_PIECES } from '@/routes/droits-routes';

/**
 * Miroir CÔTÉ FRONT de `L966_LIGNE_CREATION` / `L967_LIGNE_VALIDATION` / `INFERE_LIGNE_DECISION`
 * (`apps/api/src/auth/matrice-droits.ts`, §10 L966/L967, RM-71/RM-72) — même doctrine que
 * `ecrans/facturation/droits.ts` : un défensif d'ERGONOMIE (« un rôle sans droit ne voit pas un
 * bouton grisé, il ne voit pas de bouton »), jamais la seule ligne de défense — le serveur reste
 * l'arbitre final (`@ExigerDroit(...)` sur chaque route de `ligne-or.controller.ts`).
 *
 * `atelier.ligne.creer` (§10 L966, « ajouter une ligne constatée ») : réceptionnaire, chef
 * d'atelier, technicien, magasinier, direction, admin — TOUT LE MONDE SAUF vendeur, comptable,
 * poste_atelier. Aucun des trois exclus n'assemble `L966_LIGNE_CREATION` côté serveur
 * (`DROITS_VENDEUR`, `DROITS_COMPTABLE`, `DROITS_POSTE_ATELIER`).
 *
 * `atelier.ligne.valider` (§10 L967) / `atelier.ligne.refuser` / `atelier.ligne.annuler`
 * (inférés, RM-72/RM-71, alignés sur le périmètre de la validation) : réceptionnaire, chef
 * d'atelier, direction, admin SEULS. `technicien` et `magasinier` créent une ligne mais
 * n'arbitrent jamais son sort — exactement comme `DROITS_TECHNICIEN`/`DROITS_MAGASINIER` (côté
 * serveur) n'assemblent ni `L967_LIGNE_VALIDATION` ni `INFERE_LIGNE_DECISION`.
 */
const ROLES_CREATION_LIGNE: ReadonlySet<RoleUtilisateur> = new Set([
  'receptionnaire',
  'chef_atelier',
  'technicien',
  'magasinier',
  'direction',
  'admin',
]);

const ROLES_DECISION_LIGNE: ReadonlySet<RoleUtilisateur> = new Set([
  'receptionnaire',
  'chef_atelier',
  'direction',
  'admin',
]);

/**
 * `atelier.or.creer` (§10 L965 « ouverture d'OR », `L965_OR_OUVERTURE`) : accordé À
 * `DROITS_RECEPTIONNAIRE` seul, puis hérité par `DROITS_CHEF_ATELIER`/`DROITS_DIRECTION`/`admin`
 * (composition en chaîne côté API — voir `matrice-droits.ts`). `technicien`/`magasinier` créent des
 * LIGNES d'OR (`L966_LIGNE_CREATION`) mais jamais l'OR lui-même ; `vendeur`/`comptable`/
 * `poste_atelier` n'ont ni l'un ni l'autre. Même doctrine que `ROLES_CREATION_LIGNE` ci-dessus :
 * défensif d'ERGONOMIE (issue #47, bouton de création sur `EcranListeOrdresReparation.tsx`), le
 * serveur reste l'arbitre final (`@ExigerDroit('atelier.or.creer')` sur `POST /ordres-reparation`).
 */
const ROLES_CREATION_OR: ReadonlySet<RoleUtilisateur> = new Set([
  'receptionnaire',
  'chef_atelier',
  'direction',
  'admin',
]);

export function peutCreerOrdreReparation(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_CREATION_OR.has(role);
}

export function peutCreerLigneOr(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_CREATION_LIGNE.has(role);
}

/** Reporter un travail à la prochaine visite : mêmes rôles que le signalement sur la fiche véhicule
 *  (`ROLES_SIGNALEMENT_TRAVAIL_REPORTE`, `ecrans/vehicules/PanneauTravauxReportes.tsx`). */
const ROLES_REPORT_TRAVAIL: ReadonlySet<RoleUtilisateur> = new Set([
  'receptionnaire',
  'chef_atelier',
  'direction',
  'admin',
  'technicien',
]);

export function peutReporterTravail(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_REPORT_TRAVAIL.has(role);
}

export function peutValiderLigneOr(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_DECISION_LIGNE.has(role);
}

export function peutRefuserLigneOr(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_DECISION_LIGNE.has(role);
}

export function peutAnnulerLigneOr(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_DECISION_LIGNE.has(role);
}

/**
 * Issue #71 : `SelecteurArticlePiece` (recherche magasin depuis le dialogue « Ajouter une ligne
 * d'OR ») interroge `GET /articles/recherche-comptoir`, qui exige `pieces.article.lire`
 * (`DROITS_PIECES_PAR_ROLE`, `apps/api/src/auth/matrice-droits.ts`, RF-115) — un droit que
 * `admin` N'A PAS (`DROITS_PIECES_PAR_ROLE.admin = []`, décision assumée, cf. le commentaire de
 * `ROLES_PIECES` dans `routes/droits-routes.ts`). `ROLES_CREATION_LIGNE` ci-dessus inclut pourtant
 * `admin` (il peut créer une ligne « pièce », juste pas la faire naître d'une recherche catalogue) :
 * sans cette distinction, un `admin` voyait le champ de recherche s'ouvrir puis échouer sur
 * CHAQUE frappe (`403 DROIT_INSUFFISANT`), un geste offert qui ne pouvait jamais aboutir. Réutilise
 * `ROLES_PIECES` — LA liste des rôles qui lisent effectivement le catalogue pièces — plutôt qu'une
 * troisième énumération qui pourrait diverger des deux autres. La saisie manuelle (désignation/
 * référence/prix tapés à la main, `DialogueAjoutLigneOr`) reste TOUJOURS possible pour `admin`,
 * seul le raccourci catalogue disparaît.
 */
export function peutRechercherArticlePiece(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && (ROLES_PIECES as readonly RoleUtilisateur[]).includes(role);
}
