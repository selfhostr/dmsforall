/**
 * Implémentation de `AccesAmorcage` — les 6 seules opérations hors contexte tenant.
 *
 * Règle absolue de ce fichier : **aucune requête Drizzle directe sur les tables**. Tout passe
 * par les fonctions SECURITY DEFINER du schéma `amorcage` (migration 0001). La raison est
 * simple : ces opérations s'exécutent avant que le tenant soit connu, donc sans la protection
 * du RLS. La surface qui échappe à l'isolation doit être minuscule, figée et auditable d'un
 * seul coup d'œil — six fonctions au corps SQL statique, plutôt qu'un service libre d'écrire
 * la requête qu'il veut sur des tables non filtrées.
 *
 * Deux conséquences pratiques :
 *   - toute évolution du besoin d'amorçage passe par une MIGRATION, donc par une revue ;
 *   - les colonnes retournées sont énumérées côté base ET côté appel : une colonne ajoutée plus
 *     tard à `utilisateur` (secret TOTP, jeton de récupération) ne peut pas fuiter par accident.
 *
 * Chaque paramètre est explicitement typé côté SQL (`$1::uuid`, `$1::inet`…). Sans cela, un
 * paramètre NULL arrive en type inconnu et PostgreSQL échoue à résoudre la surcharge de la
 * fonction — panne qui n'apparaîtrait qu'avec des valeurs nulles, donc jamais au premier test.
 */

import { isIP } from 'node:net';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { NiveauAcces } from '@dfa/shared';

/**
 * Convertit en `Date` un horodatage renvoyé par la base.
 *
 * Les colonnes `timestamptz` traversent une fonction `SECURITY DEFINER` renvoyant un `TABLE(…)`,
 * et le pilote ne garantit pas toujours de rendre un `Date` plutôt qu'une chaîne ISO selon le
 * chemin d'exécution. Annoter le type ne suffit pas : c'est une promesse de compilation, pas une
 * garantie d'exécution — et la panne se manifeste par un `expireLe.getTime is not a function`
 * au premier appel authentifié, c'est-à-dire sur le chemin critique de TOUTES les requêtes.
 *
 * On normalise donc explicitement à la frontière de la base, là où la donnée entre dans le
 * domaine applicatif.
 *
 * Exportée uniquement pour le test colocalisé, comme `estAdresseIpValide` — reste hors de la
 * surface publique `db/index.ts`.
 */
export function enDate(valeur: Date | string): Date {
  return valeur instanceof Date ? valeur : new Date(valeur);
}

import { estErreurEpuisementPool, traduireErreurPoolSature } from './erreur-pool-sature';
import { JETON_CONFIG_BASE } from './db.jetons.interne';
import type {
  AccesAmorcage,
  ConfigBase,
  EvenementSecuriteEntree,
  SessionAmorcage,
  UtilisateurAmorcage,
} from './db.types';

/** Pool dédié : voir la justification dans le constructeur. */
const TAILLE_POOL_AMORCAGE = 4;

/**
 * Valide qu'une chaîne est une adresse IPv4 ou IPv6 acceptable pour le cast `::inet`.
 *
 * Correctif finding 6 (audit sécurité étape 0) : l'ancien motif `/^[0-9a-f.:%A-Z]{2,49}
 * (\/\d{1,3})?$/i` était inopérant — le drapeau `i` rend `A-Z` équivalent à TOUTES les lettres
 * (`MOTIF_IP.test('zzzzzz')` est vrai), donc n'importe quelle chaîne alphabétique le passait.
 * Une valeur invalide partait vers `${ip}::inet`, Postgres levait `22P02 invalid input syntax
 * for type inet`, `amorcage.journaliser_securite` échouait, et l'appelant avalait l'erreur :
 * une campagne de force brute pouvait rester totalement absente de `journal_securite`.
 *
 * `isIP()` de `node:net` fait la même validation stricte que PostgreSQL attend pour `inet`
 * (IPv4 pointée ou IPv6 hexadécimale, sans zone ni CIDR — ce que `req.ip`/`socket.remoteAddress`
 * ne produisent de toute façon jamais). Une IP invalide n'empêche jamais la journalisation :
 * on écrit l'événement avec `ip = NULL` plutôt que de le perdre — perdre l'IP est acceptable,
 * perdre l'événement ne l'est pas.
 *
 * Exportée uniquement pour le test colocalisé (`acces-amorcage.service.spec.ts`) — reste hors
 * de la surface publique `db/index.ts`, comme le reste de ce fichier.
 */
export function estAdresseIpValide(valeur: string): boolean {
  return isIP(valeur) !== 0;
}

@Injectable()
export class ServiceAccesAmorcage implements AccesAmorcage, OnModuleDestroy {
  private readonly journal = new Logger(ServiceAccesAmorcage.name);
  private readonly pool: Pool;
  private readonly base: NodePgDatabase<Record<string, never>>;

  constructor(@Inject(JETON_CONFIG_BASE) config: ConfigBase) {
    // Pool SÉPARÉ de celui d'AccesBase, avec la même URL (donc le même rôle dfa_app, soumis au
    // RLS pour tout ce qui n'est pas une fonction SECURITY DEFINER).
    //
    // Pourquoi ne pas partager le pool applicatif :
    //   1. cloisonnement de disponibilité — si un rapport lourd sature le pool métier,
    //      l'authentification continue de fonctionner. Une application où plus personne ne peut
    //      se connecter parce qu'une requête traîne est une panne totale ; une application lente
    //      mais accessible reste exploitable ;
    //   2. `AccesBase` ne doit exposer ni son handle Drizzle ni son `Pool` (contrat §2.8) : le
    //      partager exigerait une fuite d'abstraction ou un provider global supplémentaire ;
    //   3. `application_name` distinct rend le trafic d'authentification immédiatement lisible
    //      dans pg_stat_activity.
    //
    // Coût : 4 connexions supplémentaires au maximum. Négligeable au regard du dimensionnement
    // d'une instance qui sert 200 tenants.
    const maxAmorcage = Math.min(TAILLE_POOL_AMORCAGE, config.DATABASE_POOL_MAX);
    this.pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: maxAmorcage,
      // Même raisonnement que le pool applicatif (`acces-base.service.ts`) : garder une connexion
      // chaude évite qu'une salve de connexions se présente à froid après une purge idle sur le
      // chemin d'authentification — précisément le chemin qui doit rester réactif même quand le
      // pool applicatif, lui, est saturé (voir la justification « cloisonnement de disponibilité »
      // ci-dessus). Plafonné à `maxAmorcage`, jamais à `DATABASE_POOL_MIN` brut : un pool à 4
      // connexions au plus ne peut pas en garder 2 chaudes si `DATABASE_POOL_MIN` était réglé
      // au-delà.
      min: Math.min(config.DATABASE_POOL_MIN, maxAmorcage),
      application_name: 'dfa-api-amorcage',
      statement_timeout: config.DATABASE_TIMEOUT_REQUETE_MS,
      connectionTimeoutMillis: config.DATABASE_TIMEOUT_CONNEXION_MS,
      idleTimeoutMillis: config.DATABASE_TIMEOUT_IDLE_MS,
    });

    this.pool.on('error', (erreur) => {
      this.journal.error(
        `Erreur sur une connexion inactive du pool d'amorçage : ${erreur.message}`,
      );
    });

    // Sans schéma : ce service n'a délibérément accès à aucune table typée. Le typage ne peut
    // pas l'aider à écrire une requête directe, ce qui est exactement le but.
    this.base = drizzle(this.pool);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  /**
   * Enveloppe un appel à `this.base` pour traduire un épuisement du pool `pg` d'amorçage en
   * `ErreurMetier` 503 (`erreur-pool-sature.ts`) — même doctrine que `AccesBase.enTenant`
   * (`acces-base.service.ts`), appliquée ICI plutôt qu'une seule fois autour d'une transaction
   * commune : chacune des six opérations de ce fichier acquiert sa PROPRE connexion
   * indépendamment (`this.base.execute`, jamais `this.base.transaction`), donc chacune peut
   * échouer sur `Pool.connect` indépendamment des cinq autres.
   *
   * Prend directement la PROMESSE (pas une fonction qui la produirait) : `this.base.execute(...)`
   * a déjà démarré au moment de l'appel, exactement comme si `executer` n'existait pas — cette
   * enveloppe ne fait que rattraper le rejet, jamais différer l'exécution.
   */
  private async executer<T>(promesse: Promise<T>): Promise<T> {
    try {
      return await promesse;
    } catch (erreur) {
      if (estErreurEpuisementPool(erreur)) {
        throw traduireErreurPoolSature(erreur);
      }
      throw erreur;
    }
  }

  // -------------------------------------------------------------------------------------------
  // 1. Résolution du compte à la connexion
  // -------------------------------------------------------------------------------------------

  async utilisateurParEmail(email: string): Promise<UtilisateurAmorcage | null> {
    const resultat = await this.executer(
      this.base.execute<{
        id: string;
        tenant_id: string;
        email: string;
        mot_de_passe_hash: string;
        statut: UtilisateurAmorcage['statut'];
        statut_tenant: UtilisateurAmorcage['statutTenant'];
        role: UtilisateurAmorcage['role'];
        langue: UtilisateurAmorcage['langue'];
        echecs_connexion: number;
        // `Date | string` et non `Date` : voir enDate(). Déclarer `Date` ici serait un mensonge
        // qui rendrait l'appel à enDate() ci-dessous inutile en apparence — et donc supprimable.
        verrouille_jusqu_a: Date | string | null;
      }>(sql`
      select id, tenant_id, email, mot_de_passe_hash, statut, statut_tenant,
             role, langue, echecs_connexion, verrouille_jusqu_a
        from amorcage.utilisateur_par_email(${email}::text)
    `),
    );

    const l = resultat.rows[0];
    if (l === undefined) {
      return null;
    }

    return {
      id: l.id,
      tenantId: l.tenant_id,
      email: l.email,
      motDePasseHash: l.mot_de_passe_hash,
      statut: l.statut,
      statutTenant: l.statut_tenant,
      role: l.role,
      langue: l.langue,
      echecsConnexion: Number(l.echecs_connexion),
      // Même normalisation que sur les horodatages de session : le contrat annonce `Date | null`,
      // et l'appelant appelle `.getTime()` dessus pour décider du 423 AUTH_COMPTE_VERROUILLE. Une
      // chaîne ISO y lèverait une TypeError, convertie en 500 par le filtre global — le
      // verrouillage de compte deviendrait alors inatteignable au lieu d'être signalé.
      verrouilleJusquA: l.verrouille_jusqu_a === null ? null : enDate(l.verrouille_jusqu_a),
    };
  }

  // -------------------------------------------------------------------------------------------
  // 2. Résolution du cookie de session — exécutée à chaque requête authentifiée
  // -------------------------------------------------------------------------------------------

  async sessionParEmpreinte(empreinte: Buffer): Promise<SessionAmorcage | null> {
    // Garde-fou de cohérence avec la contrainte CHECK de la table : mieux vaut échouer ici, avec
    // un message clair, qu'obtenir un `null` indistinguable d'une session inconnue.
    if (empreinte.length !== 32) {
      throw new Error(
        `L'empreinte de session doit faire exactement 32 octets (SHA-256), reçu ${String(empreinte.length)}.`,
      );
    }

    // `Date | string` sur toutes les colonnes timestamptz : c'est ce que le pilote peut
    // réellement rendre à travers une fonction SECURITY DEFINER (voir enDate()). Le typage honnête
    // est ce qui rend les conversions ci-dessous manifestement nécessaires.
    const resultat = await this.executer(
      this.base.execute<{
        session_id: string;
        tenant_id: string;
        utilisateur_id: string;
        cree_le: Date | string;
        expire_le: Date | string;
        vu_le: Date | string;
        revoquee_le: Date | string | null;
        role: SessionAmorcage['role'];
        langue: SessionAmorcage['langue'];
        statut_utilisateur: SessionAmorcage['statutUtilisateur'];
        statut_tenant: SessionAmorcage['statutTenant'];
        site_id: string | null;
        niveau_atelier: NiveauAcces;
        niveau_accueil: NiveauAcces;
        niveau_facturation: NiveauAcces;
        niveau_pieces: NiveauAcces;
        niveau_ventes: NiveauAcces;
        niveau_finances: NiveauAcces;
        peut_encadrer: boolean;
        peut_gerer_employes: boolean;
        est_patron: boolean;
        voit_montants: boolean;
        voit_prix_achat: boolean;
        avoirs_plafonnes: boolean;
      }>(sql`
      select session_id, tenant_id, utilisateur_id, cree_le, expire_le, vu_le,
             revoquee_le, role, langue, statut_utilisateur, statut_tenant, site_id,
             niveau_atelier, niveau_accueil, niveau_facturation, niveau_pieces, niveau_ventes,
             niveau_finances, peut_encadrer, peut_gerer_employes, est_patron, voit_montants,
             voit_prix_achat, avoirs_plafonnes
        from amorcage.session_par_empreinte(${empreinte}::bytea)
    `),
    );

    const l = resultat.rows[0];
    if (l === undefined) {
      return null;
    }

    return {
      sessionId: l.session_id,
      tenantId: l.tenant_id,
      utilisateurId: l.utilisateur_id,
      creeLe: enDate(l.cree_le),
      expireLe: enDate(l.expire_le),
      vuLe: enDate(l.vu_le),
      revoqueeLe: l.revoquee_le === null ? null : enDate(l.revoquee_le),
      role: l.role,
      langue: l.langue,
      statutUtilisateur: l.statut_utilisateur,
      statutTenant: l.statut_tenant,
      // `?? null` et non `l.site_id` brut : une colonne absente de la projection (fonction SQL
      // d'une version antérieure encore en place, migration 0039 non appliquée) rendrait
      // `undefined`, qui traverserait le typage `string | null` sans que rien ne le signale.
      // Normaliser ici garantit que `siteId` vaut TOUJOURS `string` ou `null` en aval — le
      // contrôle fail-closed de `siteImposeAuPrincipal()` (auth/comptes-de-service.ts) repose
      // dessus.
      siteId: l.site_id ?? null,
      capacites: {
        niveaux: {
          atelier: l.niveau_atelier,
          accueil: l.niveau_accueil,
          facturation: l.niveau_facturation,
          pieces: l.niveau_pieces,
          ventes: l.niveau_ventes,
          finances: l.niveau_finances,
        },
        encadrer: l.peut_encadrer,
        gererEmployes: l.peut_gerer_employes,
        patron: l.est_patron,
        options: {
          voitMontants: l.voit_montants,
          voitPrixAchat: l.voit_prix_achat,
          avoirsPlafonnes: l.avoirs_plafonnes,
        },
      },
    };
  }

  // -------------------------------------------------------------------------------------------
  // 3. Expiration glissante
  // -------------------------------------------------------------------------------------------

  async toucherSession(sessionId: string, vuLe: Date): Promise<void> {
    // La fonction SQL ignore d'elle-même une session révoquée ou un horodatage qui recule :
    // l'appel est idempotent et sans effet de bord indésirable, y compris sur des requêtes
    // concurrentes arrivées dans le désordre.
    await this.executer(
      this.base.execute(sql`
      select amorcage.session_toucher(${sessionId}::uuid, ${vuLe}::timestamptz)
    `),
    );
  }

  // -------------------------------------------------------------------------------------------
  // 4 & 5. Compteur d'échecs et verrouillage progressif
  // -------------------------------------------------------------------------------------------

  async enregistrerEchecConnexion(
    utilisateurId: string,
    verrouilleJusquA: Date | null,
  ): Promise<void> {
    await this.executer(
      this.base.execute(sql`
      select amorcage.echec_connexion(
        ${utilisateurId}::uuid,
        ${verrouilleJusquA}::timestamptz
      )
    `),
    );
  }

  async reinitialiserEchecsConnexion(utilisateurId: string, connecteLe: Date): Promise<void> {
    await this.executer(
      this.base.execute(sql`
      select amorcage.reinitialiser_echecs(
        ${utilisateurId}::uuid,
        ${connecteLe}::timestamptz
      )
    `),
    );
  }

  // -------------------------------------------------------------------------------------------
  // 6. Journal de sécurité
  // -------------------------------------------------------------------------------------------

  async journaliserSecurite(evenement: EvenementSecuriteEntree): Promise<void> {
    // `details` est sérialisé explicitement puis casté : passer un objet JS brut laisserait le
    // pilote choisir sa représentation, et un `null` sans cast arriverait en type inconnu.
    const details = evenement.details === null ? null : JSON.stringify(evenement.details);

    // Voir estAdresseIpValide : une IP malformée ne doit jamais empêcher l'écriture de la trace.
    const ip = evenement.ip !== null && estAdresseIpValide(evenement.ip) ? evenement.ip : null;

    await this.executer(
      this.base.execute(sql`
      select amorcage.journaliser_securite(
        ${evenement.type}::type_evenement_securite,
        ${evenement.tenantId}::uuid,
        ${evenement.utilisateurId}::uuid,
        ${evenement.emailTente}::text,
        ${ip}::inet,
        ${evenement.userAgent}::text,
        ${details}::jsonb
      )
    `),
    );
  }
}
