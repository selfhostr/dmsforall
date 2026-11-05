import type { RoleUtilisateur } from '@dfa/shared';

/**
 * Gouvernance du sous-domaine « dossiers de vente » — DUPLIQUÉE ici depuis
 * `apps/api/src/auth/matrice-droits.ts` (bloc `DROITS_VENTES_PAR_ROLE`), jamais importée depuis
 * `apps/api` (frontière tenant/serveur jamais franchie — même règle que `ecrans/pieces/droits.ts`).
 * Défensif d'ERGONOMIE seulement : le serveur reste l'arbitre final (`403 DROIT_INSUFFISANT` géré
 * normalement via `messageErreur`).
 *
 * Cette matrice porte DEUX décisions marquées « À CONFIRMER AVEC @laupernoe » côté API (voir l'en-tête de
 * `DROITS_VENTES_PAR_ROLE`), reprises ici TELLES QUELLES plutôt que corrigées côté écran — un écran
 * qui adoucirait ces positions conservatrices divergerait silencieusement du serveur :
 *  - `admin` reçoit `[]` sur tout le domaine ventes (RF-115, décision du lot API, pas une ligne
 *    littérale de la spécification) — même palier que `pieces.*`.
 *  - `receptionnaire` NE reçoit PAS `ventes.dossier.livrer` (QV-16 non tranché, position
 *    conservatrice retenue côté API).
 */
const ROLES_LECTURE_DOSSIER_VENTE: ReadonlySet<RoleUtilisateur> = new Set([
  'direction',
  'comptable',
  'vendeur',
  'receptionnaire',
  'chef_atelier',
]);

/** §11 lignes 1/2 de la spécification (créer/modifier en `prospection`, faire signer le bon de
 *  commande) + cycle de vie complet du dossier hors livraison (`preparer`, `marquer_pret_a_livrer`,
 *  `cloturer`, `annuler`, `abandonner`) — `vendeur`, `direction` uniquement. */
const ROLES_ECRITURE_DOSSIER_VENTE: ReadonlySet<RoleUtilisateur> = new Set([
  'direction',
  'vendeur',
]);

export function peutLireDossierVente(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_LECTURE_DOSSIER_VENTE.has(role);
}

/** Couvre `creer`, `modifier`, `engager`, `preparer`, `marquer_pret_a_livrer`, `cloturer`,
 *  `annuler`, `abandonner` — TOUJOURS accordés ensemble côté matrice (`ECRITURE_DOSSIER_VENTE_HORS_LIVRAISON`). */
export function peutEcrireDossierVente(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_ECRITURE_DOSSIER_VENTE.has(role);
}
