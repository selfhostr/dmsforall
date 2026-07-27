/**
 * Enums métier partagés entre l'API et le front. Ces valeurs sont le contrat gelé de
 * l'étape 0 (voir contrats-etape-0.md §2.1) : les noms des types PostgreSQL correspondants
 * (expert-database) doivent rester identiques au singulier snake_case :
 * `langue`, `statut_tenant`, `statut_utilisateur`, `role_utilisateur`, `type_evenement_securite`.
 */

export const LANGUES = ['fr', 'de', 'it'] as const;
export type Langue = (typeof LANGUES)[number];

export const STATUTS_TENANT = ['actif', 'suspendu', 'resilie'] as const;
export type StatutTenant = (typeof STATUTS_TENANT)[number];

export const STATUTS_UTILISATEUR = ['invite', 'actif', 'suspendu'] as const;
export type StatutUtilisateur = (typeof STATUTS_UTILISATEUR)[number];

export const ROLES_UTILISATEUR = [
  'admin',
  'direction',
  'vendeur',
  'receptionnaire',
  'chef_atelier',
  'technicien',
  'magasinier',
  'comptable',
] as const;
export type RoleUtilisateur = (typeof ROLES_UTILISATEUR)[number];

export const TYPES_EVENEMENT_SECURITE = [
  'connexion_reussie',
  'connexion_echouee',
  'deconnexion',
  'compte_verrouille',
  'session_expiree',
  'session_revoquee',
] as const;
export type TypeEvenementSecurite = (typeof TYPES_EVENEMENT_SECURITE)[number];
