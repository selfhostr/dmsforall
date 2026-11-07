/**
 * Crée le premier garage d'une installation neuve : tenant, site principal, utilisateur `direction`.
 *
 * Usage (image de production) :
 *   docker compose exec api node dist/cli/creer-garage.js --garage "Garage Exemple" --email direction@example.ch
 * Usage (développement, base lancée avec `pnpm docker:up`, `.env` racine lu comme par l'API) :
 *   pnpm --filter @dfa/api exec tsx src/cli/creer-garage.ts --garage "Garage Exemple" --email direction@example.ch
 * Options : --first-name, --last-name (défaut « Direction » / « Garage »), --non-assujetti
 * (garage non assujetti à la TVA : aucune TVA sur ses documents), --help.
 * Mot de passe : variable DFA_PREMIER_MOT_DE_PASSE, sinon saisie interactive sans écho.
 *
 * Rôle de base : `dfa_migrator` (DATABASE_URL_MIGRATION) — créer un tenant est une opération
 * d'exploitation et `dfa_app`, soumis à la RLS, n'a aucune visibilité ni droit d'écriture hors d'un
 * tenant existant ; le rôle propriétaire n'est utilisé que pour ces insertions d'amorçage.
 */

import { hash, type Algorithm } from '@node-rs/argon2';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { Client } from 'pg';

import { chargerFichierEnv } from '../config/charger-fichier-env';
import {
  creerGarage,
  ErreurCreerGarage,
  type EntreeCreerGarage,
  type HacherMotDePasse,
} from './creer-garage.service';

const ARGON2ID: Algorithm = 2;
const AIDE = `Usage: creer-garage --garage <name> --email <email> [--first-name <n>] [--last-name <n>]

Creates a garage: its site, its first "direction" account, its workshop settings, an hourly
rate ("ATELIER", CHF 140.00) and a set of appointment reasons. All of it can be changed afterwards.

Options:
  --garage <name>       Garage name (required)
  --email <email>       E-mail address of the first account (required)
  --first-name <name>   First name of the account (default: Direction)
  --last-name <name>    Last name of the account (default: Garage)
  --non-assujetti       The garage is not subject to VAT (no VAT on its documents)
  --help                Show this help

Password: env DFA_PREMIER_MOT_DE_PASSE, otherwise prompted without echo.

Database: env DATABASE_URL_MIGRATION (read from the .env file at the repository root in
development), otherwise /secrets/migrator_password inside the production image.

Run:
  production   docker compose exec api node dist/cli/creer-garage.js ...
  development  pnpm --filter @dfa/api exec tsx src/cli/creer-garage.ts ...`;

/** `docker compose exec` ne passe pas par l'entrypoint : on reconstruit l'URL depuis /secrets. */
function urlMigration(): string {
  const deja = process.env.DATABASE_URL_MIGRATION;
  if (deja) return deja;
  try {
    const mdp = readFileSync('/secrets/migrator_password', 'utf8').trim();
    const hote = process.env.DFA_DB_HOST ?? 'postgres';
    const port = process.env.DFA_DB_PORT ?? '5432';
    const base = process.env.DFA_DB_NAME ?? 'dfa';
    return `postgresql://dfa_migrator:${encodeURIComponent(mdp)}@${hote}:${port}/${base}`;
  } catch {
    throw new Error(
      'DATABASE_URL_MIGRATION is not set and /secrets/migrator_password is unreadable. ' +
        'In development, set DATABASE_URL_MIGRATION in the .env file at the repository root ' +
        '(see .env.example); in production, run the command inside the api container.',
    );
  }
}

/** Saisie sans écho. */
function lireMotDePasseInteractif(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(
        new Error(
          'No TTY: set DFA_PREMIER_MOT_DE_PASSE or run with `docker compose exec` (not -T).',
        ),
      );
      return;
    }
    process.stderr.write('Password (hidden): ');
    let saisie = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const fin = (): void => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off('data', surDonnee);
      process.stderr.write('\n');
    };
    const surDonnee = (morceau: string): void => {
      for (const c of morceau) {
        if (c === '\r' || c === '\n') {
          fin();
          resolve(saisie);
          return;
        }
        if (c === '\u0003') {
          fin();
          reject(new Error('Cancelled.'));
          return;
        }
        if (c === '\u007f' || c === '\b') saisie = saisie.slice(0, -1);
        else saisie += c;
      }
    };
    process.stdin.on('data', surDonnee);
  });
}

async function principal(): Promise<number> {
  // Même chargement que l'API (`main.ts`) : le `.env` racine, sans écraser l'environnement existant.
  chargerFichierEnv();
  const { values } = parseArgs({
    options: {
      garage: { type: 'string' },
      email: { type: 'string' },
      'first-name': { type: 'string', default: 'Direction' },
      'last-name': { type: 'string', default: 'Garage' },
      'non-assujetti': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (values.help || !values.garage || !values.email) {
    (values.help ? process.stdout : process.stderr).write(`${AIDE}\n`);
    return values.help ? 0 : 2;
  }

  const motDePasse = process.env.DFA_PREMIER_MOT_DE_PASSE ?? (await lireMotDePasseInteractif());
  const entree: EntreeCreerGarage = {
    garage: values.garage,
    email: values.email,
    motDePasse,
    prenom: values['first-name'],
    nom: values['last-name'],
    assujettiTva: !values['non-assujetti'],
  };

  const hacher: HacherMotDePasse = (clair) =>
    hash(clair, {
      algorithm: ARGON2ID,
      memoryCost: Number(process.env.ARGON2_MEMOIRE_KIB ?? 19_456),
      timeCost: Number(process.env.ARGON2_ITERATIONS ?? 2),
      parallelism: Number(process.env.ARGON2_PARALLELISME ?? 1),
    });

  const client = new Client({
    connectionString: urlMigration(),
    application_name: 'dfa-creer-garage',
  });
  await client.connect();
  try {
    const r = await creerGarage(client, entree, hacher);
    process.stdout.write(
      [
        `Garage created: ${entree.garage} (slug ${r.slug}, tenant ${r.tenantId})`,
        `Site created: ${r.siteCode} (${r.siteId})`,
        `User created: ${r.email} (role ${r.role}, ${r.utilisateurId})`,
        '',
      ].join('\n'),
    );
    return 0;
  } finally {
    await client.end();
  }
}

principal().then(
  (code) => process.exit(code),
  (erreur: unknown) => {
    const message = erreur instanceof Error ? erreur.message : String(erreur);
    process.stderr.write(
      `${erreur instanceof ErreurCreerGarage ? `Refused [${erreur.code}]` : 'Error'}: ${message}\n`,
    );
    process.exit(1);
  },
);
