/**
 * Jeu de données de démonstration : un garage valaisan à deux sites.
 *
 * Objectifs :
 *   - permettre de se connecter à l'application dès `pnpm db:seed`, sans écran d'inscription
 *     (qui n'existe pas à l'étape 0 et n'existera jamais : les comptes sont créés par le garage) ;
 *   - donner aux tests manuels des données réalistes, en vocabulaire de garagiste suisse.
 *
 * IDEMPOTENT : rejouable autant de fois que voulu. Chaque enregistrement est identifié par sa
 * clé métier (slug du tenant, code du site, email de l'utilisateur) et mis à jour s'il existe
 * déjà. Un seed qu'on ne peut lancer qu'une fois est un seed qu'on n'utilise pas.
 *
 * Se connecte avec `DATABASE_URL_MIGRATION` (rôle `dfa_migrator`) : créer un tenant est une
 * opération d'exploitation, pas une opération applicative, et `dfa_app` n'a de toute façon
 * aucune visibilité hors de son tenant courant.
 */

import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { basename } from 'node:path';
import { Client } from 'pg';

import * as schema from '../schema';
import { site, tenant, utilisateur } from '../schema';

/**
 * Mot de passe de démonstration, volontairement présent en clair dans le dépôt : il ne protège
 * rien, il ouvre un jeu de données factice sur une base de développement. Le vrai garde-fou est
 * que ce script REFUSE de s'exécuter en production (voir `semerDev`).
 */
export const MOT_DE_PASSE_DEMO = 'Demo1234!Garage';

export const SLUG_TENANT_DEMO = 'garage-martin';

/** Paramètres Argon2id du contrat §2.7 (recommandations OWASP courantes). */
const ARGON2_MEMOIRE_KIB = 19_456;
const ARGON2_ITERATIONS = 2;
const ARGON2_PARALLELISME = 1;

/** Signature attendue de `ServiceMotDePasse.hacher` (contrat §2.10). */
export type HacherMotDePasse = (clair: string) => Promise<string>;

export interface OptionsSeed {
  /** URL de connexion du rôle `dfa_migrator`. */
  readonly urlMigration: string;
  readonly nodeEnv: string;
  /**
   * Fonction de hachage. À fournir de préférence depuis `ServiceMotDePasse` : le seed produit
   * alors exactement les mêmes hachages que l'application, avec les paramètres de la
   * configuration réelle. Sans elle, on retombe sur Argon2id aux paramètres par défaut
   * ci-dessus — le hachage des mots de passe n'appartient pas à la couche base de données, et
   * cette dépendance reste donc optionnelle et inversée.
   */
  readonly hacherMotDePasse?: HacherMotDePasse;
  readonly journaliser?: (message: string) => void;
}

// ---------------------------------------------------------------------------------------------
// Hachage
// ---------------------------------------------------------------------------------------------

interface ModuleArgon2Napi {
  hash(clair: string, options: Record<string, unknown>): Promise<string>;
}

/**
 * Charge Argon2id depuis `@node-rs/argon2` (binaires précompilés — pas de chaîne de compilation
 * native à installer sous Windows) ou, à défaut, depuis `argon2`.
 *
 * Le spécificateur est typé `string` et non littéral : TypeScript n'exige donc pas que ces
 * modules soient résolvables à la compilation. `src/db/` n'a pas à dépendre d'une bibliothèque
 * de hachage — c'est le domaine de `src/auth/`.
 */
async function chargerHacheurParDefaut(): Promise<HacherMotDePasse> {
  const nodeRs: string = '@node-rs/argon2';
  try {
    const mod = (await import(nodeRs)) as ModuleArgon2Napi;
    return (clair) =>
      mod.hash(clair, {
        memoryCost: ARGON2_MEMOIRE_KIB,
        timeCost: ARGON2_ITERATIONS,
        parallelism: ARGON2_PARALLELISME,
        algorithm: 2, // Algorithm.Argon2id
      });
  } catch {
    // On essaie l'implémentation alternative avant d'abandonner.
  }

  const classique: string = 'argon2';
  try {
    const mod = (await import(classique)) as ModuleArgon2Napi;
    return (clair) =>
      mod.hash(clair, {
        memoryCost: ARGON2_MEMOIRE_KIB,
        timeCost: ARGON2_ITERATIONS,
        parallelism: ARGON2_PARALLELISME,
        type: 2, // argon2id
      });
  } catch {
    throw new Error(
      `Aucune implémentation Argon2 disponible (@node-rs/argon2 ou argon2).\n` +
        `Installer @node-rs/argon2, ou appeler semerDev({ hacherMotDePasse }) en fournissant ` +
        `ServiceMotDePasse.hacher.`,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Données de démonstration
// ---------------------------------------------------------------------------------------------

const SITES_DEMO = [
  {
    code: 'SION',
    nom: 'Garage Martin — Sion',
    rue: 'Route de Riddes 42',
    npa: '1950',
    localite: 'Sion',
  },
  {
    code: 'MARTIGNY',
    nom: 'Garage Martin — Martigny',
    rue: 'Avenue du Grand-Saint-Bernard 18',
    npa: '1920',
    localite: 'Martigny',
  },
] as const;

const UTILISATEURS_DEMO = [
  {
    email: 'admin@garage-martin.ch',
    prenom: 'Pierre',
    nom: 'Martin',
    role: 'admin',
    langue: 'fr',
  },
  {
    email: 'chef.atelier@garage-martin.ch',
    prenom: 'Sophie',
    nom: 'Rossier',
    role: 'chef_atelier',
    langue: 'fr',
  },
] as const;

// ---------------------------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------------------------

export async function semerDev(options: OptionsSeed): Promise<{ tenantId: string }> {
  const journaliser = options.journaliser ?? ((m: string) => process.stdout.write(`${m}\n`));

  // Garde-fou non négociable : ce script crée des comptes dont le mot de passe est public.
  if (options.nodeEnv === 'production') {
    throw new Error(
      `Le seed de démonstration est interdit en production : il crée des comptes dont le mot de passe est publié dans le dépôt.`,
    );
  }

  const hacher = options.hacherMotDePasse ?? (await chargerHacheurParDefaut());

  const client = new Client({
    connectionString: options.urlMigration,
    application_name: 'dfa-seed',
  });
  await client.connect();
  const base = drizzle(client, { schema });

  try {
    // Le tout dans UNE transaction : un seed interrompu ne laisse pas un tenant sans site ni
    // sans compte administrateur, état dont personne ne saurait quoi faire.
    await client.query('begin');

    // --- Tenant --------------------------------------------------------------------------------
    const [ligneTenant] = await base
      .insert(tenant)
      .values({
        slug: SLUG_TENANT_DEMO,
        raisonSociale: 'Garage Martin SA',
        numeroTva: 'CHE-123.456.789 TVA',
        pays: 'CH',
        langueDefaut: 'fr',
        statut: 'actif',
      })
      .onConflictDoUpdate({
        target: tenant.slug,
        set: {
          raisonSociale: 'Garage Martin SA',
          pays: 'CH',
          langueDefaut: 'fr',
          // On réactive : un rejeu du seed doit rendre le tenant utilisable même s'il a été
          // suspendu à la main pour tester le code d'erreur AUTH_TENANT_SUSPENDU.
          statut: 'actif',
        },
      })
      .returning({ id: tenant.id });

    if (ligneTenant === undefined) {
      throw new Error(`Le tenant de démonstration n'a pas pu être créé.`);
    }
    const tenantId = ligneTenant.id;
    journaliser(`Tenant « ${SLUG_TENANT_DEMO} » (${tenantId})`);

    // --- Sites ---------------------------------------------------------------------------------
    for (const s of SITES_DEMO) {
      await base
        .insert(site)
        .values({
          tenantId,
          code: s.code,
          nom: s.nom,
          rue: s.rue,
          npa: s.npa,
          localite: s.localite,
          pays: 'CH',
          actif: true,
        })
        .onConflictDoUpdate({
          target: [site.tenantId, site.code],
          set: { nom: s.nom, rue: s.rue, npa: s.npa, localite: s.localite, actif: true },
        });
      journaliser(`  site ${s.code} — ${s.nom}`);
    }

    // --- Utilisateurs --------------------------------------------------------------------------
    for (const u of UTILISATEURS_DEMO) {
      // Hachage à chaque exécution : le sel change, le mot de passe non. C'est idempotent au
      // sens qui compte — l'état final permet toujours de se connecter avec MOT_DE_PASSE_DEMO.
      const motDePasseHash = await hacher(MOT_DE_PASSE_DEMO);

      await base
        .insert(utilisateur)
        .values({
          tenantId,
          email: u.email,
          motDePasseHash,
          prenom: u.prenom,
          nom: u.nom,
          langue: u.langue,
          role: u.role,
          statut: 'actif',
        })
        .onConflictDoUpdate({
          target: utilisateur.email,
          set: {
            motDePasseHash,
            prenom: u.prenom,
            nom: u.nom,
            langue: u.langue,
            role: u.role,
            // Remise à l'état nominal : un compte verrouillé pendant les tests de force brute
            // redevient utilisable après un simple `pnpm db:seed`.
            statut: 'actif',
            echecsConnexion: 0,
            verrouilleJusquA: null,
          },
        });
      journaliser(`  utilisateur ${u.email} (${u.role})`);
    }

    // Contrôle de cohérence : le tenant de démonstration doit avoir au moins un administrateur,
    // faute de quoi personne ne peut rien faire de ce jeu de données.
    const admins = await base
      .select({ id: utilisateur.id })
      .from(utilisateur)
      .where(eq(utilisateur.tenantId, tenantId));

    if (admins.length < UTILISATEURS_DEMO.length) {
      throw new Error(
        `Incohérence : ${String(admins.length)} utilisateur(s) pour le tenant de démonstration, ` +
          `${String(UTILISATEURS_DEMO.length)} attendus. Un email est probablement déjà pris par un autre tenant.`,
      );
    }

    await client.query('commit');

    journaliser('');
    journaliser(`Connexion : ${UTILISATEURS_DEMO[0].email} / ${MOT_DE_PASSE_DEMO}`);

    return { tenantId };
  } catch (erreur) {
    await client.query('rollback');
    throw erreur;
  } finally {
    await client.end();
  }
}

// ---------------------------------------------------------------------------------------------
// Point d'entrée CLI
// ---------------------------------------------------------------------------------------------

function estPointDEntree(): boolean {
  const argument = process.argv[1];
  return argument !== undefined && /^seed-dev(\.[cm]?[jt]s)?$/.test(basename(argument));
}

async function principal(): Promise<void> {
  const { chargerFichierEnv } = await import('../../config/charger-fichier-env');
  chargerFichierEnv();
  const { chargerConfig } = await import('../../config/charger-config');
  const config = chargerConfig(process.env);

  await semerDev({
    urlMigration: config.DATABASE_URL_MIGRATION,
    nodeEnv: config.NODE_ENV,
  });
}

if (estPointDEntree()) {
  principal().catch((erreur: unknown) => {
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    process.stderr.write(`\nÉchec du seed : ${message}\n`);
    process.exitCode = 1;
  });
}
