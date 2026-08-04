/**
 * Types et interfaces publics de la couche base de données (contrat gelé étape 0, §2.8).
 *
 * Règle structurante : `AccesBase` est le SEUL point d'entrée vers les tables métier, et il
 * n'expose jamais le handle Drizzle brut ni le `Pool` pg. Toute requête métier passe par
 * `enTenant()`, qui pose les GUC `app.*` en portée transaction — c'est ce qui rend le RLS
 * effectif et compatible avec un pool de connexions (voir acces-base.service.ts).
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type {
  Langue,
  RoleUtilisateur,
  StatutTenant,
  StatutUtilisateur,
  TypeEvenementSecurite,
} from '@dfa/shared';

import type * as schema from './schema';

// ---------------------------------------------------------------------------------------------
// Handles Drizzle
// ---------------------------------------------------------------------------------------------

/** Base Drizzle typée par le schéma complet du socle. */
export type BaseDfa = NodePgDatabase<typeof schema>;

/**
 * Transaction Drizzle. Extrait du type de `BaseDfa['transaction']` plutôt que réécrit à la main :
 * si Drizzle change sa signature, la compilation casse ici au lieu de dériver silencieusement.
 */
export type TransactionDfa = Parameters<Parameters<BaseDfa['transaction']>[0]>[0];

// ---------------------------------------------------------------------------------------------
// Contexte tenant
// ---------------------------------------------------------------------------------------------

/**
 * Contexte porté par chaque unité de travail métier. Construit par
 * `ServiceContexteRequete.contexteTenant()` (§2.9) et passé en premier paramètre explicite à
 * tout service métier — le tenant n'est jamais deviné ni lu depuis la requête HTTP.
 */
export interface ContexteTenant {
  /** uuid, validé avant tout SQL (voir `ServiceAccesBase.enTenant`). */
  readonly tenantId: string;
  /** `null` = tâche système (job BullMQ, migration de données, seed). */
  readonly utilisateurId: string | null;
  /** Corrélation logs / `X-Requete-Id` / `instance` du problem+json. */
  readonly requeteId: string | null;
}

// ---------------------------------------------------------------------------------------------
// Accès base — surface publique
// ---------------------------------------------------------------------------------------------

export interface AccesBase {
  /**
   * SEUL point d'entrée vers les tables métier.
   *
   * Ouvre une transaction, y exécute
   * `select set_config('app.tenant_id',$1,true), set_config('app.utilisateur_id',$2,true),
   *         set_config('app.requete_id',$3,true)`
   * (3e argument `true` = portée transaction) puis appelle `travail`.
   *
   * Le GUC est réinitialisé par Postgres au COMMIT/ROLLBACK : la connexion rendue au pool ne
   * conserve donc aucun tenant. C'est la condition sine qua non de l'étanchéité inter-tenant
   * en environnement poolé (et sous PgBouncer en mode transaction).
   */
  enTenant<T>(ctx: ContexteTenant, travail: (tx: TransactionDfa) => Promise<T>): Promise<T>;

  /** Ping simple (`select 1`) — utilisé par `GET /api/v1/sante/pret`. */
  verifierConnexion(): Promise<void>;

  /**
   * Assertion de démarrage. Lève si :
   * - `current_user` est superuser, `BYPASSRLS`, ou propriétaire d'une table du schéma public ;
   * - une table du schéma public n'a pas `relrowsecurity` ;
   * - une table portant `tenant_id` (ou la table `tenant`) n'a pas de politique complète
   *   (`USING` **et** `WITH CHECK`) applicable au rôle courant ;
   * - une table censée porter `FORCE ROW LEVEL SECURITY` ne l'a pas ;
   * - une table **sans `tenant_id`** ne déclare pas pourquoi, par un marqueur de posture dans son
   *   commentaire (`[dfa:referentiel-partage]` ou `[dfa:hors-portee-app]`), ou déclare une posture
   *   que ses privilèges réels contredisent ;
   * - le rôle courant détient `DELETE` sur une table non déclarée `[dfa:suppression-physique]`,
   *   ou `TRUNCATE` sur quoi que ce soit.
   *
   * Voir `migrations/0002_posture_declaree.sql` pour le vocabulaire des marqueurs et le
   * raisonnement : une déclaration n'accorde rien, elle décrit une posture qui est vérifiée.
   *
   * Fail-closed : mieux vaut une API qui refuse de démarrer qu'une API qui tourne sans RLS.
   */
  verifierPostureRls(): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// Amorçage — les 6 seules opérations hors contexte tenant
// ---------------------------------------------------------------------------------------------

/** Projection retournée par `amorcage.utilisateur_par_email` — colonnes explicites, jamais `select *`. */
export interface UtilisateurAmorcage {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly motDePasseHash: string;
  readonly statut: StatutUtilisateur;
  readonly statutTenant: StatutTenant;
  readonly role: RoleUtilisateur;
  readonly langue: Langue;
  readonly echecsConnexion: number;
  readonly verrouilleJusquA: Date | null;
}

/** Projection retournée par `amorcage.session_par_empreinte`. */
export interface SessionAmorcage {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly utilisateurId: string;
  readonly creeLe: Date;
  readonly expireLe: Date;
  readonly vuLe: Date;
  readonly revoqueeLe: Date | null;
  readonly role: RoleUtilisateur;
  readonly langue: Langue;
  readonly statutUtilisateur: StatutUtilisateur;
  readonly statutTenant: StatutTenant;
  /**
   * `utilisateur.site_id` (migration 0037) : site de rattachement d'un COMPTE DE SERVICE
   * (`ROLES_COMPTE_DE_SERVICE`, aujourd'hui la borne d'atelier), `null` pour tout compte de
   * personne. Contrainte en base : `poste_atelier` ⇔ `site_id` renseigné.
   *
   * Remonté ICI, donc résolu à chaque requête depuis le seul cookie de session — c'est ce qui
   * rend impossible qu'un client déclare le site de sa borne (même doctrine que le tenant).
   */
  readonly siteId: string | null;
}

/** Entrée du journal de sécurité. `tenantId` nullable : un échec sur email inconnu n'a pas de tenant. */
export interface EvenementSecuriteEntree {
  readonly type: TypeEvenementSecurite;
  readonly tenantId: string | null;
  readonly utilisateurId: string | null;
  readonly emailTente: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly details: Readonly<Record<string, unknown>> | null;
}

/**
 * Les 6 SEULES opérations hors contexte tenant.
 *
 * Elles existent parce qu'au moment de la connexion on ne connaît pas encore le tenant : c'est
 * précisément ce que la requête cherche à établir. Elles sont implémentées EXCLUSIVEMENT par
 * appel des fonctions `SECURITY DEFINER` du schéma `amorcage` — aucune requête Drizzle directe
 * sur les tables, aucun `select *`, aucune clause construite dynamiquement.
 */
export interface AccesAmorcage {
  /** `email` déjà normalisé (trim + lowercase) par le schéma zod de connexion. */
  utilisateurParEmail(email: string): Promise<UtilisateurAmorcage | null>;
  /** `empreinte` = SHA-256 (32 octets) du jeton de session en clair. */
  sessionParEmpreinte(empreinte: Buffer): Promise<SessionAmorcage | null>;
  toucherSession(sessionId: string, vuLe: Date): Promise<void>;
  enregistrerEchecConnexion(utilisateurId: string, verrouilleJusquA: Date | null): Promise<void>;
  reinitialiserEchecsConnexion(utilisateurId: string, connecteLe: Date): Promise<void>;
  journaliserSecurite(evenement: EvenementSecuriteEntree): Promise<void>;
}

// ---------------------------------------------------------------------------------------------
// Configuration consommée par la couche base
// ---------------------------------------------------------------------------------------------

/**
 * Sous-ensemble de `Config` (§2.7) réellement lu par `src/db/`.
 *
 * Déclaré structurellement plutôt qu'importé depuis `src/config/` : la couche base documente
 * ainsi exactement ce qu'elle consomme, et `Config` (plus large) lui reste assignable sans
 * créer de dépendance de compilation entre deux répertoires appartenant à deux experts.
 */
export interface ConfigBase {
  readonly NODE_ENV: 'development' | 'test' | 'production';
  /** Rôle `dfa_app` — NOSUPERUSER, NOBYPASSRLS, non propriétaire. */
  readonly DATABASE_URL: string;
  readonly DATABASE_POOL_MAX: number;
  readonly DATABASE_TIMEOUT_REQUETE_MS: number;
}
