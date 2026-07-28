/**
 * Runner de migrations.
 *
 * Écrit à la main plutôt que délégué à `drizzle-kit migrate`, pour trois raisons qui comptent
 * sur un produit destiné à durer :
 *   1. les migrations du socle contiennent du SQL que `drizzle-kit generate` ne sait pas
 *      produire — politiques RLS, fonctions SECURITY DEFINER, GRANT, triggers ;
 *   2. l'empreinte de chaque fichier appliqué est vérifiée à chaque exécution : une migration
 *      partie en production devient immuable, et toute retouche est détectée au lieu de
 *      diverger silencieusement d'une base à l'autre ;
 *   3. un verrou consultatif empêche deux instances qui démarrent en même temps d'appliquer
 *      la même migration en parallèle.
 *
 * Se connecte avec `DATABASE_URL_MIGRATION` (rôle `dfa_migrator`), jamais avec `DATABASE_URL` :
 * le rôle applicatif n'a aucun droit de modifier le schéma, et c'est ce qui rend l'assertion
 * `verifierPostureRls()` opérante.
 *
 * Usage CLI      : `pnpm db:migrate` (depuis apps/api)
 * Usage programme: `await appliquerMigrations({ urlMigration })` — utilisé par les tests
 *                  d'intégration pour préparer une base éphémère (testcontainers).
 */

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { Client } from 'pg';

/**
 * Verrou consultatif de session. Valeur arbitraire mais STABLE : deux runners concurrents
 * doivent choisir le même entier pour que le verrou serve à quelque chose.
 */
const VERROU_MIGRATION = 4_820_251_103n;

/** Table de suivi. Le double tiret bas la distingue des tables métier au premier coup d'œil. */
const TABLE_SUIVI = '__dfa_migrations';

export interface OptionsMigration {
  /** URL de connexion du rôle `dfa_migrator`. */
  readonly urlMigration: string;
  /** Répertoire des fichiers `NNNN_*.sql`. Résolu automatiquement si absent. */
  readonly repertoire?: string;
  /** Journalisation ; `console.log` par défaut en CLI, silencieux possible en test. */
  readonly journaliser?: (message: string) => void;
}

export interface ResultatMigration {
  readonly appliquees: readonly string[];
  readonly dejaAppliquees: readonly string[];
}

/** Une migration déjà appliquée a été modifiée depuis : situation qui ne se rattrape pas seule. */
export class ErreurMigrationAlteree extends Error {
  constructor(nom: string) {
    super(
      `La migration « ${nom} » a été modifiée après son application sur cette base.\n` +
        `Une migration appliquée est immuable : les bases déjà migrées ne rejoueront jamais la ` +
        `nouvelle version, et divergeraient silencieusement.\n` +
        `Correction : restaurer le fichier dans son état d'origine et créer une NOUVELLE migration ` +
        `portant le changement.`,
    );
    this.name = 'ErreurMigrationAlteree';
  }
}

/**
 * Empreinte du contenu, insensible au style de fin de ligne.
 *
 * Indispensable en pratique : sur un poste Windows, Git peut restituer les fichiers en CRLF.
 * Sans cette normalisation, la même migration produirait deux empreintes différentes selon la
 * machine, et le contrôle d'immuabilité déclencherait de fausses alertes à chaque `git clone`.
 */
function empreinte(contenu: string): string {
  return createHash('sha256').update(contenu.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

/**
 * Localise le répertoire des migrations sans lire `process.env` (contrat §2.7 : seuls
 * `charger-config.ts` et `main.ts` y touchent) et sans dépendre de `__dirname`, indisponible
 * en modules ES.
 */
function trouverRepertoireMigrations(): string {
  const candidats = [
    join(process.cwd(), 'src', 'db', 'migrations'),
    join(process.cwd(), 'dist', 'db', 'migrations'),
    join(process.cwd(), 'apps', 'api', 'src', 'db', 'migrations'),
    join(process.cwd(), 'apps', 'api', 'dist', 'db', 'migrations'),
  ];

  const trouve = candidats.find((c) => existsSync(c));
  if (trouve === undefined) {
    throw new Error(
      `Répertoire de migrations introuvable. Chemins essayés :\n` +
        candidats.map((c) => `  - ${c}`).join('\n') +
        `\nLancer la commande depuis apps/api, ou passer l'option \`repertoire\`.`,
    );
  }
  return trouve;
}

/** `0000_socle.sql`, `0001_socle_rls.sql`, … Le sous-répertoire `down/` est ignoré. */
async function listerMigrations(repertoire: string): Promise<readonly string[]> {
  const entrees = await readdir(repertoire, { withFileTypes: true });

  const fichiers = entrees
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name)
    // Tri lexicographique : la numérotation sur 4 chiffres le rend équivalent à un tri
    // numérique jusqu'à 10 000 migrations.
    .sort((a, b) => a.localeCompare(b, 'en'));

  const invalides = fichiers.filter((f) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(f));
  if (invalides.length > 0) {
    throw new Error(
      `Nom de migration non conforme (attendu NNNN_nom_en_minuscules.sql) : ${invalides.join(', ')}`,
    );
  }

  const numeros = fichiers.map((f) => f.slice(0, 4));
  const doublons = numeros.filter((n, i) => numeros.indexOf(n) !== i);
  if (doublons.length > 0) {
    throw new Error(
      `Deux migrations portent le même numéro (${doublons.join(', ')}) : l'ordre d'application serait indéterminé.`,
    );
  }

  return fichiers;
}

export async function appliquerMigrations(
  options: OptionsMigration,
): Promise<ResultatMigration> {
  const journaliser = options.journaliser ?? ((m: string) => process.stdout.write(`${m}\n`));
  const repertoire =
    options.repertoire === undefined
      ? trouverRepertoireMigrations()
      : isAbsolute(options.repertoire)
        ? options.repertoire
        : resolve(process.cwd(), options.repertoire);

  const fichiers = await listerMigrations(repertoire);

  // Un `Client` unique, et non un `Pool` : le verrou consultatif de session doit rester attaché
  // à LA connexion qui applique les migrations du début à la fin.
  const client = new Client({
    connectionString: options.urlMigration,
    application_name: 'dfa-migrations',
    // Pas de statement_timeout : la création d'un index sur une grosse table peut légitimement
    // durer plusieurs minutes, et une migration interrompue à mi-parcours est bien pire qu'une
    // migration lente.
    statement_timeout: 0,
  });

  await client.connect();

  const appliquees: string[] = [];
  const dejaAppliquees: string[] = [];

  try {
    // --- Table de suivi ------------------------------------------------------------------------
    await client.query(`
      create table if not exists public.${TABLE_SUIVI} (
        nom         text        not null primary key,
        empreinte   text        not null,
        applique_le timestamptz not null default now(),
        duree_ms    integer     not null
      )
    `);

    // RLS activé sans aucune politique : le rôle applicatif ne voit rien de cette table. C'est
    // aussi ce qui permet à `verifierPostureRls()` d'exiger `relrowsecurity` sur TOUTES les
    // tables du schéma public, sans liste d'exception à maintenir.
    await client.query(`alter table public.${TABLE_SUIVI} enable row level security`);
    await client.query(`revoke all on public.${TABLE_SUIVI} from dfa_app`);

    // Déclaration de posture (voir 0002_posture_declaree.sql) : cette table n'a pas de
    // `tenant_id`, et `verifierPostureRls()` refuse au démarrage toute table sans `tenant_id`
    // qui ne déclare pas pourquoi. Le marqueur est posé ICI et non dans une migration parce que
    // la table est créée par ce runner, avant que la moindre migration ne s'exécute — y compris
    // sur une base vierge. `comment on table` est idempotent.
    await client.query(`
      comment on table public.${TABLE_SUIVI} is
        'Suivi des migrations appliquées (nom, empreinte, durée). [dfa:hors-portee-app] '
        'Table d''infrastructure du runner de migrations : dfa_app n''y a aucun privilège, '
        'elle n''est lisible que par dfa_migrator.'
    `);

    // --- Verrou : deux instances qui démarrent ensemble ne doivent pas migrer en parallèle -----
    journaliser("Acquisition du verrou de migration…");
    await client.query('select pg_advisory_lock($1)', [VERROU_MIGRATION.toString()]);

    const { rows: deja } = await client.query<{ nom: string; empreinte: string }>(
      `select nom, empreinte from public.${TABLE_SUIVI}`,
    );
    const empreintesConnues = new Map(deja.map((l) => [l.nom, l.empreinte]));

    for (const fichier of fichiers) {
      const contenu = await readFile(join(repertoire, fichier), 'utf8');
      const somme = empreinte(contenu);
      const connue = empreintesConnues.get(fichier);

      if (connue !== undefined) {
        if (connue !== somme) {
          throw new ErreurMigrationAlteree(fichier);
        }
        dejaAppliquees.push(fichier);
        continue;
      }

      journaliser(`Application de ${fichier}…`);
      const debut = Date.now();

      // Une transaction PAR migration : le DDL PostgreSQL étant transactionnel, une migration
      // qui échoue ne laisse aucune trace, et les précédentes restent acquises. Pas de « moitié
      // de migration » à démêler à la main.
      await client.query('begin');
      try {
        // search_path déterministe : le comportement de la migration ne doit pas dépendre de la
        // configuration du rôle ou de la base.
        await client.query('set local search_path = public');
        await client.query(contenu);
        await client.query(
          `insert into public.${TABLE_SUIVI} (nom, empreinte, duree_ms) values ($1, $2, $3)`,
          [fichier, somme, Date.now() - debut],
        );
        await client.query('commit');
      } catch (erreur) {
        await client.query('rollback');
        throw erreur;
      }

      appliquees.push(fichier);
      journaliser(`  ✓ ${fichier} (${String(Date.now() - debut)} ms)`);
    }

    if (appliquees.length === 0) {
      journaliser(`Base à jour — ${String(dejaAppliquees.length)} migration(s) déjà appliquée(s).`);
    } else {
      journaliser(`${String(appliquees.length)} migration(s) appliquée(s).`);
    }

    return { appliquees, dejaAppliquees };
  } finally {
    // `pg_advisory_unlock` explicite plutôt que de compter sur la fermeture : si la connexion
    // met du temps à être libérée côté serveur, le runner suivant attendrait pour rien.
    try {
      await client.query('select pg_advisory_unlock($1)', [VERROU_MIGRATION.toString()]);
    } catch {
      // Connexion déjà perdue : le verrou tombera avec elle.
    }
    await client.end();
  }
}

// ---------------------------------------------------------------------------------------------
// Point d'entrée CLI
// ---------------------------------------------------------------------------------------------

/**
 * Détecte l'exécution directe (`tsx src/db/migrer.ts`) sans recourir à `require.main` (absent en
 * ESM) ni à `import.meta` (absent en CommonJS) : le fichier reste utilisable dans les deux
 * modes de compilation.
 */
function estPointDEntree(): boolean {
  const argument = process.argv[1];
  return argument !== undefined && /^migrer(\.[cm]?[jt]s)?$/.test(basename(argument));
}

async function principal(): Promise<void> {
  // Seule lecture de l'environnement tolérée hors `charger-config.ts` / `main.ts` : ce script
  // est un exécutable autonome, il n'a pas de conteneur d'injection à interroger. Et il passe
  // par `chargerConfig`, donc par la MÊME validation que l'API — une URL de migration absente
  // ou identique à l'URL applicative est refusée ici comme au démarrage du serveur.
  const { chargerFichierEnv } = await import('../config/charger-fichier-env');
  chargerFichierEnv();
  const { chargerConfig } = await import('../config/charger-config');
  const config = chargerConfig(process.env);

  await appliquerMigrations({ urlMigration: config.DATABASE_URL_MIGRATION });
}

if (estPointDEntree()) {
  principal().catch((erreur: unknown) => {
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    process.stderr.write(`\nÉchec des migrations : ${message}\n`);

    // Une configuration invalide doit dire LAQUELLE. Sans ce détail, l'opérateur ne lit qu'un
    // décompte (« 5 variable(s) fautive(s) ») et doit deviner — exactement ce que le refus de
    // démarrage était censé lui éviter.
    if (
      erreur !== null &&
      typeof erreur === 'object' &&
      'problemes' in erreur &&
      Array.isArray((erreur as { problemes: unknown }).problemes)
    ) {
      const problemes = (erreur as { problemes: ReadonlyArray<{ variable: string; message: string }> })
        .problemes;
      for (const probleme of problemes) {
        process.stderr.write(`  - ${probleme.variable} : ${probleme.message}\n`);
      }
    }

    process.exitCode = 1;
  });
}
