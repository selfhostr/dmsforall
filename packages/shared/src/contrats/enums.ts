/**
 * Enums métier partagés entre l'API et le front. Ces valeurs sont le contrat gelé de
 * l'étape 0 (voir contrats-etape-0.md §2.1) : les noms des types PostgreSQL correspondants
 * (l'équipe base de données) doivent rester identiques au singulier snake_case :
 * `langue`, `statut_tenant`, `statut_utilisateur`, `role_utilisateur`, `type_evenement_securite`.
 */

export const LANGUES = ['fr', 'de', 'it'] as const;
export type Langue = (typeof LANGUES)[number];

export const STATUTS_TENANT = ['actif', 'suspendu', 'resilie'] as const;
export type StatutTenant = (typeof STATUTS_TENANT)[number];

export const STATUTS_UTILISATEUR = ['invite', 'actif', 'suspendu'] as const;
export type StatutUtilisateur = (typeof STATUTS_UTILISATEUR)[number];

/**
 * Rôles d'un compte. Les huit premiers sont des rôles de PERSONNE (étape 0, contrat gelé §2.1) ;
 * `poste_atelier` est le premier — et à ce jour le seul — rôle de COMPTE DE SERVICE
 * (`ROLES_COMPTE_DE_SERVICE` ci-dessous).
 *
 * L'ORDRE EST SIGNIFIANT : `apps/api/src/db/schema/enums.ts` construit le type PostgreSQL
 * `role_utilisateur` directement depuis ce tableau. Une valeur ne s'ajoute qu'À LA FIN, et jamais
 * sans la migration correspondante (`0039` pour `poste_atelier`).
 */
export const ROLES_UTILISATEUR = [
  'admin',
  'direction',
  'vendeur',
  'receptionnaire',
  'chef_atelier',
  'technicien',
  'magasinier',
  'comptable',
  'poste_atelier',
] as const;
export type RoleUtilisateur = (typeof ROLES_UTILISATEUR)[number];

/**
 * Rôles qui ne désignent AUCUNE personne physique — un appareil, pas un employé.
 *
 * `poste_atelier` : la borne tactile murale de l'atelier (mode « borne partagée » du pointage,
 * `docs/specification-pointage-borne.md` §0.2). C'est un compte de connexion ordinaire — même
 * table `utilisateur`, même mot de passe Argon2id, même session cookie — qui se distingue sur
 * trois points, tous portés par le schéma et la matrice de droits, jamais par un `if` isolé :
 *
 *  1. **Il est rattaché à UN site** (`utilisateur.site_id NOT NULL`, imposé par la contrainte
 *     `utilisateur_site_compte_de_service_chk` : `poste_atelier` ⇔ `site_id` renseigné). Ce site
 *     est résolu depuis la SESSION (`PrincipalAuthentifie.siteId`), jamais depuis un paramètre de
 *     requête — même doctrine que le tenant.
 *  2. **Ses droits sont minimaux** : lire les OR de son site, écrire des pointages, identifier un
 *     technicien par PIN. Aucun geste sensible, aucun montant (`ROLES_SANS_MONTANT`).
 *  3. **Il ne peut jamais être le SUJET d'un pointage** : un compte de service ne travaille pas.
 *     C'est le PIN qui désigne le technicien réel derrière le geste.
 *
 * Sert de garde-fou à tout code qui suppose « un rôle = une personne » : liste de techniciens,
 * destinataire d'une notification, signataire d'un document, affectation d'une tâche.
 */
export const ROLES_COMPTE_DE_SERVICE = ['poste_atelier'] as const;
export type RoleCompteDeService = (typeof ROLES_COMPTE_DE_SERVICE)[number];

/**
 * `true` si ce rôle désigne un appareil et non une personne. À préférer systématiquement à
 * `role === 'poste_atelier'` : le jour où un second compte de service existe (borne d'accueil,
 * afficheur de planning), tous les appels de cette fonction restent corrects sans être retouchés.
 */
export function estCompteDeService(role: RoleUtilisateur): role is RoleCompteDeService {
  return (ROLES_COMPTE_DE_SERVICE as readonly RoleUtilisateur[]).includes(role);
}

/**
 * Rôle désignant une personne physique — complément exact de `RoleCompteDeService`.
 *
 * À utiliser partout où un `Record<RoleUtilisateur, …>` décrit quelque chose qui n'a de sens que
 * pour un employé (une identité de fixture, un libellé de trombinoscope, un destinataire de
 * notification). Le compilateur exige alors d'énumérer les huit rôles de personne, et REFUSE une
 * entrée `poste_atelier` — au lieu d'en réclamer une qu'on remplirait par mimétisme.
 */
export type RolePersonne = Exclude<RoleUtilisateur, RoleCompteDeService>;

/** Rôles désignant une personne physique — complément exact de `ROLES_COMPTE_DE_SERVICE`. */
export const ROLES_PERSONNE: readonly RolePersonne[] = ROLES_UTILISATEUR.filter(
  (role): role is RolePersonne => !estCompteDeService(role),
);

export const TYPES_EVENEMENT_SECURITE = [
  'connexion_reussie',
  'connexion_echouee',
  'deconnexion',
  'compte_verrouille',
  'session_expiree',
  'session_revoquee',
  // --- Réinitialisation de mot de passe en libre-service (auth/services/reinitialisation-mot-de-
  // passe.service.ts) — même doctrine de journalisation que connexion_reussie/connexion_echouee :
  // deux issues possibles par étape, la RAISON précise (email inconnu, jeton expiré/déjà
  // utilisé/inconnu, compte suspendu…) vit dans `details` (JSONB), jamais dans une valeur d'enum
  // dédiée, pour ne pas faire exploser ce type à chaque nuance.
  'reinitialisation_demandee',
  'reinitialisation_echouee',
  'reinitialisation_reussie',
] as const;
export type TypeEvenementSecurite = (typeof TYPES_EVENEMENT_SECURITE)[number];
