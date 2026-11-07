import type { RoleUtilisateur } from '@dfa/shared';

/**
 * Gouvernance du widget calendrier de l'écran « Aujourd'hui » — DUPLIQUÉE depuis
 * `apps/api/src/auth/matrice-droits.ts` (`LECTURE_OR`), jamais importée depuis `apps/api`
 * (frontière tenant/serveur, jamais franchie — même doctrine que `ecrans/pneus/droits.ts` et
 * `ecrans/ventes/dossiers/droits.ts`).
 *
 * `atelier.or.lire` est accordé à tous les rôles de personne SAUF `vendeur` (§10, aucun besoin
 * identifié en étape 1 — voir le commentaire de tête de `DROITS_VENDEUR` côté API). Les quatre
 * rôles qui atterrissent réellement sur `EcranAccueil` (`direction`, `admin`, `receptionnaire`,
 * `chef_atelier`, voir `routes/atterrissage.ts`) l'ont tous — cette fonction reste néanmoins
 * posée en défense, pas en confort : un rôle sans le droit ne doit ni voir le widget vide, ni
 * déclencher la requête (même règle que `peutLireDossierVente`, `ecrans/ventes/dossiers/droits.ts`).
 */
export function peutLireEcheancesOr(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && role !== 'vendeur';
}

/**
 * Rôles « de bureau » dont l'accueil commence par la recherche et les actions rapides (plaque,
 * client ou n° d'OR ; créer un OR, un rendez-vous, un devis, encaisser). Les techniciens, le
 * magasinier et le poste d'atelier gardent leur propre point d'entrée (`routes/atterrissage.ts`) ;
 * `admin` n'a aucun droit métier. Chaque ACTION reste en plus gouvernée par son droit propre.
 */
export const ROLES_ACCUEIL_BUREAU: readonly RoleUtilisateur[] = [
  'direction',
  'receptionnaire',
  'chef_atelier',
  'comptable',
];

/** Le bloc « à faire aujourd'hui » : tout le bureau sauf le comptable, dont le tableau de bord
 *  porte déjà les factures à encaisser et à relancer. */
export const ROLES_A_FAIRE_AUJOURDHUI: readonly RoleUtilisateur[] = [
  'direction',
  'receptionnaire',
  'chef_atelier',
];

export function estRoleAccueilBureau(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_ACCUEIL_BUREAU.includes(role);
}

export function voitAFaireAujourdhui(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_A_FAIRE_AUJOURDHUI.includes(role);
}
