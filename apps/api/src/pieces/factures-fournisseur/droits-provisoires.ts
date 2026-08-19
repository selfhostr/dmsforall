import type { RoleUtilisateur } from '@dfa/shared';

import { ErreurMetier } from '../../common/erreurs';

/**
 * PALLIATIF TEMPORAIRE — même situation, même solution déjà éprouvée dans ce dépôt
 * (`clients/droits-provisoires.ts`, `pneus/droits-provisoires.ts`, `relances/droits-provisoires.ts`) :
 * `apps/api/src/pieces/factures-fournisseur/` (périmètre d'écriture de cette tâche) n'a PAS accès
 * en écriture à `apps/api/src/auth/matrice-droits.ts` (propriété d'un autre agent). Les quatre
 * actions introduites pour ce lot n'existent donc pas encore dans la matrice :
 *   - `pieces.facture_fournisseur.lire`     (GET /factures-fournisseur, GET /{id}, GET /{id}/document)
 *   - `pieces.facture_fournisseur.deposer`  (POST /factures-fournisseur)
 *   - `pieces.facture_fournisseur.valider`  (POST /{id}/valider)
 *   - `pieces.facture_fournisseur.rejeter`  (POST /{id}/rejeter)
 *
 * Les routes portent `@AucunDroitRequis()` (authentifié suffit pour passer `GardeDroit`,
 * `common/droits/garde-droit.ts`) et la vérification RÉELLE du rôle est faite ICI, appelée en
 * tout DÉBUT de chaque méthode concernée de `ServiceFactureFournisseur`, AVANT tout accès base.
 *
 * À FAIRE PAR expert-auth quand `matrice-droits.ts` est accessible à cette tâche : ajouter les
 * quatre actions ci-dessus à `Action`, une entrée fusionnée dans `MATRICE_DROITS` avec EXACTEMENT
 * les rôles ci-dessous, puis dans CE module : remplacer les `@AucunDroitRequis()` du contrôleur
 * par `@ExigerDroit(...)`, retirer les appels à `verifierRoleAutorise` (redondants avec
 * `GardeDroit`), et supprimer ce fichier.
 */

/**
 * Écriture (dépôt, validation, rejet) : `magasinier` (reçoit les pièces au quotidien, RP-26 —
 * même rôle déjà titulaire de `pieces.mouvement.creer`/`pieces.stock.modifier`), `direction` et
 * `admin` (supervision). `chef_atelier`/`comptable`/`vendeur`/`technicien`/`poste_atelier`/
 * `receptionnaire` EXCLUS : aucun n'est au contact du magasin fournisseur au sens de cette tâche.
 */
export const ROLES_FACTURE_FOURNISSEUR_ECRITURE: readonly RoleUtilisateur[] = [
  'admin',
  'direction',
  'magasinier',
];

/**
 * Lecture : les rôles d'écriture PLUS `comptable` (pièce comptable soumise à conservation dix
 * ans, art. 958f CO — le fiduciaire doit pouvoir la consulter).
 */
export const ROLES_FACTURE_FOURNISSEUR_LECTURE: readonly RoleUtilisateur[] = [
  ...ROLES_FACTURE_FOURNISSEUR_ECRITURE,
  'comptable',
];

/** Lève `403 DROIT_INSUFFISANT` si `role` n'est pas dans `rolesAutorises` — voir l'en-tête. */
export function verifierRoleAutorise(
  role: RoleUtilisateur,
  rolesAutorises: readonly RoleUtilisateur[],
  nomAction: string,
): void {
  if (!rolesAutorises.includes(role)) {
    throw new ErreurMetier(
      'DROIT_INSUFFISANT',
      `Le rôle "${role}" n'a pas le droit d'effectuer l'action "${nomAction}".`,
    );
  }
}
