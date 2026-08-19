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
const ROLES_ECRITURE_ARTICLE: ReadonlySet<RoleUtilisateur> = new Set([
  'direction',
  'chef_atelier',
  'magasinier',
]);

/** Inféré — réglages de stock par site (emplacement/seuils, PP-08) : même périmètre que
 *  l'écriture article (donnée de référentiel). */
const ROLES_ECRITURE_STOCK_SITE: ReadonlySet<RoleUtilisateur> = new Set([
  'direction',
  'chef_atelier',
  'magasinier',
]);

/** §11 « Enregistrer une entrée/sortie », « Réceptionner », « Faire l'inventaire » : `magasinier`
 *  SEUL, de façon ferme. */
const ROLES_ECRITURE_MOUVEMENT: ReadonlySet<RoleUtilisateur> = new Set(['magasinier']);

/** §11 « Enregistrer une sortie » (satisfaire une réservation) : même périmètre que les
 *  mouvements, `magasinier` seul. */
const ROLES_SATISFACTION_RESERVATION: ReadonlySet<RoleUtilisateur> = new Set(['magasinier']);

/** §11 « Libérer une réservation active » : direction, chef_atelier, magasinier. */
const ROLES_LIBERATION_RESERVATION: ReadonlySet<RoleUtilisateur> = new Set([
  'direction',
  'chef_atelier',
  'magasinier',
]);

/**
 * Second relais (étape 3, sous-fonctions commande fournisseur/fournisseur/consigne) — dupliqué
 * depuis `DROITS_PIECES_PAR_ROLE` (`apps/api/src/auth/matrice-droits.ts`), même règle de gouvernance
 * que le bloc ci-dessus (frontière tenant/serveur jamais franchie, défensif d'ergonomie seulement).
 *
 * Lecture fournisseur/commande fournisseur : direction, chef_atelier, magasinier — PAS vendeur,
 * receptionnaire, technicien (lecture générale `pieces.*` seulement), ni comptable, ni admin
 * (RF-115, `[]` littéral).
 */
const ROLES_LECTURE_FOURNISSEUR: ReadonlySet<RoleUtilisateur> = new Set([
  'direction',
  'chef_atelier',
  'magasinier',
]);

/** Écriture fournisseur (`creer` + `modifier`, TOUJOURS accordés ensemble côté matrice) : mêmes
 *  trois rôles que la lecture — couvre création, modification, désactivation, réactivation. */
const ROLES_ECRITURE_FOURNISSEUR: ReadonlySet<RoleUtilisateur> = new Set([
  'direction',
  'chef_atelier',
  'magasinier',
]);

/** Écriture commande fournisseur (`creer` — couvre aussi `envoyer` et `annuler` la commande
 *  entière, gardés par le MÊME droit côté contrôleur) : direction, chef_atelier, magasinier. */
const ROLES_ECRITURE_COMMANDE_FOURNISSEUR: ReadonlySet<RoleUtilisateur> = new Set([
  'direction',
  'chef_atelier',
  'magasinier',
]);

/** Réception (`pieces.commande_fournisseur.reception` — couvre aussi `annuler-reliquat`, gardé
 *  par le MÊME droit côté contrôleur) : `magasinier` SEUL, comme les mouvements de stock. */
const ROLES_RECEPTION_COMMANDE_FOURNISSEUR: ReadonlySet<RoleUtilisateur> = new Set(['magasinier']);

/** Lecture consigne : direction, chef_atelier, magasinier, ET comptable (donnée financière —
 *  « une consigne jamais rendue est une créance qui dort », INFÉRÉ côté matrice API). */
const ROLES_LECTURE_CONSIGNE: ReadonlySet<RoleUtilisateur> = new Set([
  'direction',
  'chef_atelier',
  'magasinier',
  'comptable',
]);

/** Retour fournisseur d'une consigne (`pieces.consigne.retourner`) : `magasinier` SEUL — le geste
 *  de comptoir qui constate physiquement le retour. */
const ROLES_RETOUR_CONSIGNE: ReadonlySet<RoleUtilisateur> = new Set(['magasinier']);

/**
 * Paramétrage pièces (`pieces.parametrage.lire`/`pieces.parametrage.modifier`,
 * `apps/api/src/auth/matrice-droits.ts`) — LECTURE accordée à `direction`, `chef_atelier` ET
 * `magasinier` (« exécute la politique de stock, ne la fixe pas »), ÉCRITURE réservée à
 * `direction`/`chef_atelier` seuls, un sous-ensemble strict. Distinct des deux constantes
 * précédentes : ni un droit d'article, ni un droit de fournisseur.
 */
const ROLES_LECTURE_PARAMETRAGE_PIECES: ReadonlySet<RoleUtilisateur> = new Set([
  'direction',
  'chef_atelier',
  'magasinier',
]);
const ROLES_ECRITURE_PARAMETRAGE_PIECES: ReadonlySet<RoleUtilisateur> = new Set([
  'direction',
  'chef_atelier',
]);

/**
 * Factures fournisseur (dépôt/rapprochement) — INFÉRÉ (pas encore de `matrice-droits.ts` côté
 * serveur, le service est écrit EN PARALLÈLE par un autre agent, voir
 * `hooks/pieces/factures-fournisseur.temporaire.ts`). Lecture élargie à `comptable` (pièce
 * comptable, RF-115 mise à part `admin` reste `[]`) — même périmètre que `ROLES_LECTURE_CONSIGNE`
 * ci-dessus, même raisonnement (« une créance/dépense qui dort »). Dépôt et validation réservés à
 * `magasinier` SEUL (« le magasinier confirme », brief) — même périmètre que
 * `ROLES_ECRITURE_MOUVEMENT`. À confronter à la matrice réelle dès qu'elle existe côté serveur.
 */
const ROLES_LECTURE_FACTURE_FOURNISSEUR: ReadonlySet<RoleUtilisateur> = new Set([
  'direction',
  'chef_atelier',
  'magasinier',
  'comptable',
]);
const ROLES_ECRITURE_FACTURE_FOURNISSEUR: ReadonlySet<RoleUtilisateur> = new Set(['magasinier']);

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

export function peutLireFournisseur(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_LECTURE_FOURNISSEUR.has(role);
}

export function peutEcrireFournisseur(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_ECRITURE_FOURNISSEUR.has(role);
}

export function peutLireCommandeFournisseur(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_LECTURE_FOURNISSEUR.has(role);
}

/** Créer, envoyer, annuler (la commande entière) : même droit côté contrôleur. */
export function peutEcrireCommandeFournisseur(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_ECRITURE_COMMANDE_FOURNISSEUR.has(role);
}

/** Réceptionner, annuler un reliquat de ligne : même droit côté contrôleur, `magasinier` seul. */
export function peutReceptionnerCommandeFournisseur(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_RECEPTION_COMMANDE_FOURNISSEUR.has(role);
}

export function peutLireConsigne(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_LECTURE_CONSIGNE.has(role);
}

export function peutRetournerConsigne(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_RETOUR_CONSIGNE.has(role);
}

export function peutLireParametragePieces(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_LECTURE_PARAMETRAGE_PIECES.has(role);
}

export function peutModifierParametragePieces(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_ECRITURE_PARAMETRAGE_PIECES.has(role);
}

export function peutLireFactureFournisseur(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_LECTURE_FACTURE_FOURNISSEUR.has(role);
}

/** Déposer une facture ET confirmer son rapprochement : même droit, `magasinier` seul. */
export function peutDeposerFactureFournisseur(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_ECRITURE_FACTURE_FOURNISSEUR.has(role);
}

/** Valider OU rejeter le rapprochement : même droit côté contrôleur (déduit, `magasinier` seul —
 *  « le magasinier confirme », brief). Un seul nom couvre les DEUX transitions terminales
 *  (`STATUTS_FACTURE_FOURNISSEUR`, `@dfa/shared`) : elles engagent la même décision humaine. */
export function peutDeciderFactureFournisseur(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_ECRITURE_FACTURE_FOURNISSEUR.has(role);
}
