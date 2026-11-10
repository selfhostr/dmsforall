/**
 * Amorçage des rôles applicatifs, lancé par l'entrypoint de l'image API avant les migrations.
 *
 * Se connecte avec le superutilisateur du conteneur PostgreSQL (`DFA_AMORCAGE_URL`, fournie
 * uniquement à ce processus par l'entrypoint, jamais à l'API) et crée, s'ils n'existent pas, les
 * deux rôles que l'application utilise réellement : `dfa_migrator` (propriétaire du schéma,
 * migrations seulement) et `dfa_app` (API et worker, soumis à la RLS). Le superutilisateur ne
 * sert jamais à l'application : il contournerait la RLS.
 *
 * Idempotent : à chaque démarrage, les mots de passe sont réalignés sur les fichiers de
 * `/data/secrets`, les droits sont reposés à l'identique. Mêmes droits que
 * `docker/postgres/init/01-roles.sql` (version de développement, mots de passe fixes).
 */

import { basename } from 'node:path';
import { Client } from 'pg';

/** Entrée de la fonction pure : de quoi construire les requêtes, rien d'autre. */
export interface EntreeAmorcageRoles {
  readonly baseDeDonnees: string;
  readonly motDePasseApp: string;
  readonly motDePasseMigrator: string;
}

type Echapper = (valeur: string) => string;

/** Requêtes à exécuter dans l'ordre. `echapperLitteral` = `Client.escapeLiteral`. */
export function requetesAmorcageRoles(
  entree: EntreeAmorcageRoles,
  echapperLitteral: Echapper,
  echapperIdentifiant: Echapper,
): readonly string[] {
  const roles: ReadonlyArray<readonly [string, string]> = [
    ['dfa_migrator', entree.motDePasseMigrator],
    ['dfa_app', entree.motDePasseApp],
  ];
  const requetes: string[] = [];
  for (const [role, motDePasse] of roles) {
    const attributs = 'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS';
    requetes.push(
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN ` +
        `CREATE ROLE ${role} ${attributs}; END IF; END $$`,
      `ALTER ROLE ${role} WITH ${attributs} PASSWORD ${echapperLitteral(motDePasse)}`,
    );
  }
  requetes.push(
    'ALTER SCHEMA public OWNER TO dfa_migrator',
    'REVOKE ALL ON SCHEMA public FROM PUBLIC',
    'GRANT USAGE ON SCHEMA public TO dfa_migrator',
    'GRANT USAGE ON SCHEMA public TO dfa_app',
    `GRANT CREATE ON DATABASE ${echapperIdentifiant(entree.baseDeDonnees)} TO dfa_migrator`,
  );
  return requetes;
}

/** Cause la plus courante : un dossier ./data/postgres d'une autre installation. */
export const MESSAGE_MOT_DE_PASSE_REFUSE =
  'PostgreSQL refuses the password stored in ./data/secrets. ./data/postgres already holds a ' +
  'database created with other passwords (another installation, or ./data/secrets was deleted or ' +
  'replaced). Either restore the matching ./data/secrets folder, or, if that database is not ' +
  'needed, stop the stack (docker compose down) and delete ./data/postgres and ./data/secrets to ' +
  'start from scratch.';

async function principal(): Promise<void> {
  const url = process.env.DFA_AMORCAGE_URL;
  const motDePasseApp = process.env.DFA_AMORCAGE_MDP_APP;
  const motDePasseMigrator = process.env.DFA_AMORCAGE_MDP_MIGRATOR;
  if (!url || !motDePasseApp || !motDePasseMigrator) {
    throw new Error(
      'DFA_AMORCAGE_URL, DFA_AMORCAGE_MDP_APP and DFA_AMORCAGE_MDP_MIGRATOR are required.',
    );
  }
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
  } catch (erreur) {
    if ((erreur as { code?: string }).code === '28P01')
      throw new Error(MESSAGE_MOT_DE_PASSE_REFUSE);
    throw erreur;
  }
  try {
    const base = (await client.query<{ db: string }>('SELECT current_database() AS db')).rows[0]
      ?.db;
    if (base === undefined) throw new Error('Cannot read the current database name.');
    const requetes = requetesAmorcageRoles(
      { baseDeDonnees: base, motDePasseApp, motDePasseMigrator },
      (v) => client.escapeLiteral(v),
      (v) => client.escapeIdentifier(v),
    );
    for (const requete of requetes) await client.query(requete);
  } finally {
    await client.end();
  }
}

function estPointDEntree(): boolean {
  const argument = process.argv[1];
  return argument !== undefined && /^amorcer-roles(\.[cm]?[jt]s)?$/.test(basename(argument));
}

if (estPointDEntree()) {
  principal().catch((erreur: unknown) => {
    process.stderr.write(`Database role setup failed: ${String(erreur)}\n`);
    process.exit(1);
  });
}
