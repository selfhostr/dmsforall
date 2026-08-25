/**
 * Garde-fou : croise les opérations SQL RÉELLEMENT émises par le code applicatif avec les droits
 * RÉELLEMENT accordés au rôle `dfa_app` en base — et échoue si le code a besoin d'un privilège
 * qu'il n'a pas.
 *
 * Pourquoi ce contrôle existe (défaut historique qu'il aurait attrapé) : la migration qui a créé
 * `reprise_analyse` n'accordait à `dfa_app` que `select, insert, update` ; un service exécutait
 * `DELETE FROM public.reprise_analyse` à chaque appel. 500 sur toutes les archives, 5700 tests
 * verts — aucun ne passait par ce chemin. `verifierPostureRls()`
 * (apps/api/src/db/acces-base.service.ts) ne pouvait structurellement pas le voir : elle vérifie
 * que tout DELETE ACCORDÉ est bien DÉCLARÉ (marqueur `[dfa:suppression-physique]`), sens unique —
 * elle ne lit jamais le SQL que le code émet. Ce fichier fait l'inverse : partir du code, vérifier
 * la base.
 *
 * Mécanisme retenu, et ce qui a été écarté :
 *
 *   1. RECENSER LES OPÉRATIONS DU CODE — analyse du query-builder Drizzle (`.insert(x)`,
 *      `.update(x)`, `.delete(x)`), pas du SQL textuel. Écarté : grep sur `delete from`/
 *      `insert into` — le code du dépôt n'écrit JAMAIS de SQL brut pour ces opérations (il passe
 *      systématiquement par Drizzle), un tel grep n'aurait donc rien trouvé DU TOUT sur les
 *      chemins réels, et resterait bruyant sur les commentaires/tests qui citent du SQL en texte.
 *      Retenu : extraire `.insert/.update/.delete(IDENTIFIANT)` puis résoudre IDENTIFIANT contre
 *      la table réelle de `apps/api/src/db/schema/**` (`export const x = pgTable('nom_reel', …)`).
 *      Cette résolution sert d'ALLOWLIST STRUCTURELLE : un identifiant qui n'est pas un export de
 *      table connu est ignoré — c'est ce qui élimine par construction `Map.delete()`,
 *      `Set.delete()`, `Hash.update()`, sans liste d'exclusion à maintenir à la main. Mesuré sur
 *      le dépôt réel (24.08.2026) : 180 appels bruts, 91 paires (table, privilège) distinctes
 *      résolues, 9 non résolus — les 9 vérifiés un par un sont tous des faux positifs légitimement
 *      écartés (Map/Set/crypto/buffer). 0 faux positif dans les 91 paires retenues (vérifié en
 *      lisant le code source des occurrences génériques : `client`, `session`, `pointage`, …).
 *
 *      Ce que ce mécanisme NE couvre PAS (limite assumée, pas un oubli) :
 *        - SQL construit dynamiquement (aucune occurrence dans le dépôt à ce jour) ;
 *        - `apps/api/src/db/seed/**` : exclu en bloc. La plupart de ces scripts se connectent en
 *          `dfa_migrator` (propriétaire, aucun droit à vérifier) — SAUF
 *          `seed-rendez-vous-demo.ts`, qui passe bien par `dfa_app`. Distinguer fichier par
 *          fichier le rôle de connexion réel aurait exigé une analyse plus fine pour un gain nul
 *          ici : les tables qu'il touche (`rendez_vous`, `ordre_reparation`, `motif_rendez_vous`)
 *          sont déjà couvertes par d'autres appelants de production dans le périmètre analysé.
 *          Faux négatif accepté, documenté, jamais un faux positif ;
 *        - SELECT : volontairement hors périmètre. `.from(x)`/`.select()` sont des noms bien plus
 *          génériques ailleurs dans une base de code (`Array.from`, générateurs, etc.) — risque de
 *          faux positifs nettement plus élevé pour un gain faible : un SELECT manquant échoue sur
 *          la toute première lecture, chemin déjà couvert par l'écrasante majorité des tests
 *          existants. Le défaut historique portait sur DELETE, jamais sur SELECT.
 *
 *   2. LIRE LES DROITS — `has_table_privilege()`, interrogé EN SE CONNECTANT COMME `dfa_app` sur
 *      une vraie base migrée (testcontainers, harnais existant `postgres-ephemere.ts`), pas
 *      `information_schema.role_table_grants` ni une lecture des fichiers de migration. Écarté :
 *      - `role_table_grants` : ne montre que les lignes où le rôle courant est grantor/grantee/
 *        membre — interrogé depuis un rôle tiers (CI), ça peut rester incomplet sans jouer sur les
 *        droits d'introspection. `has_table_privilege(current_user, …)` répond exactement à la
 *        question posée (« CE rôle peut-il faire CECI »), sans ce risque ;
 *      - lire les fichiers de migration (grep `grant … to dfa_app`) : ne demande pas de base,
 *        mais RETOMBE dans le même problème structurel que `verifierPostureRls()` — un GRANT peut
 *        être révoqué ou modifié par une migration ultérieure (0070 qui repasse derrière 0068),
 *        le texte d'UNE migration ne dit rien de l'état FINAL cumulé. Seule une vraie base migrée
 *        jusqu'au bout donne la vérité.
 *      Bonus à coût nul : `to_regclass()` avant `has_table_privilege()` détecte aussi une table
 *      RÉFÉRENCÉE PAR LE CODE MAIS ABSENTE DU SCHÉMA MIGRÉ (renommage oublié, migration non
 *      appliquée) — même requête, même mécanisme, retenu. Colonnes lues/absentes et politiques RLS
 *      manquantes : PAS retenus ici (nécessitent de résoudre les clés Drizzle vers les noms de
 *      colonnes réels côté `.values()`/`.set()`, coût nettement supérieur ; RLS manquante est déjà
 *      couvert par `verifierPostureRls()`) — signalés comme suite possible, pas traités.
 *
 *   3. BRANCHEMENT — test d'intégration (`apps/api/test/integration/db/droits-sql.spec.ts`),
 *      collecté par `pnpm test:integration`, donc par le job CI « Tests d'intégration
 *      (testcontainers) » qui tourne déjà sur CHAQUE push/PR vers `dev`. Écarté : une étape CI
 *      dédiée (sur le modèle de `verifier-reversibilite-migrations.sh`) réimplémenterait un second
 *      mécanisme de démarrage Postgres + rejeu de `01-roles.sql` + migrations, avec le risque
 *      concret que CE second harnais diverge un jour de celui déjà éprouvé
 *      (`postgres-ephemere.ts`, commenté « doit reproduire la POSTURE DE PRODUCTION ») — soit
 *      exactement la classe de bug que cet outil existe pour empêcher. Réutiliser le harnais
 *      existant prime sur un nom de check CI séparé. Vérification au démarrage de l'app : écarté
 *      — coûteux à faire tourner à chaque boot de prod pour un défaut qui doit être attrapé AVANT
 *      le déploiement, pas constaté dessus.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const RACINE_API_SRC = path.resolve(__dirname, '../apps/api/src');
const RACINE_SCHEMA = path.join(RACINE_API_SRC, 'db/schema');

/** Répertoires dont AUCUN appel `.insert/.update/.delete()` n'est attribué à `dfa_app` — voir
 *  l'en-tête pour la justification détaillée de chacun. */
const REPERTOIRES_EXCLUS = [
  path.join(RACINE_API_SRC, 'db/schema'), // définitions de tables elles-mêmes, pas des appels
  path.join(RACINE_API_SRC, 'db/seed'), // connectés en dfa_migrator, sauf seed-rendez-vous-demo.ts
  path.join(RACINE_API_SRC, 'db/migrations'), // SQL brut, pas du Drizzle — analysé par ailleurs
];

/**
 * Fichiers individuels qui se connectent en `dfa_migrator` (DATABASE_URL_MIGRATION) sans passer
 * par `db/seed/` ni `db/migrer.ts` — donc pas couverts par `REPERTOIRES_EXCLUS` ci-dessus.
 *
 *   - `db/migrer.ts` : le migrateur lui-même.
 *   - `vehicules/referentiel/etat-import-referentiel-vehicules-ch.ts` : trouvé par la MESURE, pas
 *     par lecture de code — première exécution de ce contrôle contre le dépôt réel (24.08.2026),
 *     un seul faux positif sur les 91 paires extraites. Son propre en-tête documente le choix :
 *     « MÊME PATRON DE CONNEXION que db/seed/import-referentiel-vehicules-ch.ts : un `pg.Client`
 *     dédié sur DATABASE_URL_MIGRATION, JAMAIS AccesBase/JETON_DB — dfa_app n'a que SELECT sur
 *     cette table ». Vérifié : c'est le SEUL fichier hors `db/seed/`/`db/migrer.ts`, parmi tous
 *     ceux contribuant aux 91 paires, qui référence `DATABASE_URL_MIGRATION`/`urlMigration`/
 *     `dfa_migrator` — grep exhaustif sur la liste complète des fichiers contributeurs.
 *
 * Risque assumé : un futur fichier du même patron (client `pg` direct sur le rôle migrateur, hors
 * `db/seed/`) échapperait à cette liste et produirait un NOUVEAU faux positif — donc du bruit,
 * jamais un défaut masqué (le sens de l'erreur reste toujours « en sécurité »). Une IA/relecteur
 * qui verrait ce contrôle échouer sur un tel fichier doit l'ajouter ici avec la même justification,
 * pas relâcher la vérification.
 */
const FICHIERS_EXCLUS = new Set([
  path.join(RACINE_API_SRC, 'db/migrer.ts'),
  path.join(RACINE_API_SRC, 'vehicules/referentiel/etat-import-referentiel-vehicules-ch.ts'),
]);

type Privilege = 'INSERT' | 'UPDATE' | 'DELETE';

export interface OperationTable {
  readonly table: string;
  readonly privilege: Privilege;
  readonly fichier: string;
  readonly ligne: number;
}

function listerFichiersTs(racine: string): string[] {
  const resultats: string[] = [];
  const pile = [racine];
  while (pile.length > 0) {
    const courant = pile.pop();
    if (courant === undefined) break;
    for (const entree of readdirSync(courant, { withFileTypes: true })) {
      const cheminComplet = path.join(courant, entree.name);
      if (entree.isDirectory()) {
        if (entree.name === 'node_modules') continue;
        pile.push(cheminComplet);
      } else if (entree.isFile() && entree.name.endsWith('.ts')) {
        resultats.push(cheminComplet);
      }
    }
  }
  return resultats;
}

/** `export const identifiant = pgTable('nom_reel', …)` — seule grammaire utilisée dans le dépôt
 *  (vérifié : 47/47 fichiers de `db/schema/**` suivent ce patron, nom de table toujours en premier
 *  argument littéral). */
const MOTIF_TABLE = /export const (\w+)\s*=\s*pgTable\(\s*['"]([a-z0-9_]+)['"]/g;

export function extraireTableMap(): Map<string, string> {
  const carte = new Map<string, string>();
  for (const fichier of listerFichiersTs(RACINE_SCHEMA)) {
    const contenu = readFileSync(fichier, 'utf8');
    for (const trouve of contenu.matchAll(MOTIF_TABLE)) {
      const identifiant = trouve[1];
      const nomTable = trouve[2];
      if (identifiant === undefined || nomTable === undefined) continue;
      carte.set(identifiant, nomTable);
    }
  }
  return carte;
}

const MOTIF_OPERATION = /\.(insert|update|delete)\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g;
const PRIVILEGE_PAR_METHODE: Record<string, Privilege> = {
  insert: 'INSERT',
  update: 'UPDATE',
  delete: 'DELETE',
};

function estExclu(chemin: string): boolean {
  if (chemin.endsWith('.spec.ts') || chemin.endsWith('.test.ts')) return true;
  if (FICHIERS_EXCLUS.has(chemin)) return true;
  return REPERTOIRES_EXCLUS.some((rep) => chemin.startsWith(rep + path.sep));
}

/**
 * Extrait toutes les opérations `.insert/.update/.delete(IDENTIFIANT)` du code applicatif dont
 * l'IDENTIFIANT résout vers une table connue de `tableMap`. Tout identifiant qui ne résout à rien
 * (variable locale, `Map`/`Set`/`Buffer`/`Hash`, …) est silencieusement ignoré — c'est
 * l'allowlist structurelle qui tient lieu de filtre anti-faux-positifs, voir l'en-tête du fichier.
 */
export function extraireOperationsCode(tableMap: ReadonlyMap<string, string>): OperationTable[] {
  const operations: OperationTable[] = [];
  for (const fichier of listerFichiersTs(RACINE_API_SRC)) {
    if (estExclu(fichier)) continue;
    const contenu = readFileSync(fichier, 'utf8');
    for (const trouve of contenu.matchAll(MOTIF_OPERATION)) {
      const methode = trouve[1];
      const identifiant = trouve[2];
      if (methode === undefined || identifiant === undefined) continue;
      const table = tableMap.get(identifiant);
      if (table === undefined) continue;
      const privilege = PRIVILEGE_PAR_METHODE[methode];
      if (privilege === undefined) continue;
      const ligne = contenu.slice(0, trouve.index).split('\n').length;
      operations.push({
        table,
        privilege,
        fichier: path.relative(RACINE_API_SRC, fichier),
        ligne,
      });
    }
  }
  return operations;
}

/** Dédoublonne par (table, privilège) — c'est cette paire qui compte pour la base, pas le nombre
 *  d'appels. Garde un exemple d'occurrence (le premier rencontré) pour un message d'erreur utile. */
export function dedoublonnerParTableEtPrivilege(
  operations: readonly OperationTable[],
): Map<string, OperationTable> {
  const paires = new Map<string, OperationTable>();
  for (const op of operations) {
    const cle = `${op.table}::${op.privilege}`;
    if (!paires.has(cle)) paires.set(cle, op);
  }
  return paires;
}

export interface ProblemeTableAbsente {
  readonly type: 'table-absente';
  readonly table: string;
  readonly exemple: OperationTable;
}

export interface ProblemeDroitManquant {
  readonly type: 'droit-manquant';
  readonly table: string;
  readonly privilege: Privilege;
  readonly exemple: OperationTable;
}

export type Probleme = ProblemeTableAbsente | ProblemeDroitManquant;

/** Fonction de requête minimale — un `pg.Pool`/`pg.Client` satisfait cette forme, un mock aussi. */
export type Interrogateur = (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>;

/**
 * Croise les opérations extraites avec les droits réels du rôle CONNECTÉ (`current_user`) — donc
 * appelé avec un pool ouvert en `dfa_app`, jamais un pool superutilisateur/propriétaire, sinon le
 * contrôle ne prouverait rien (mêmes précautions que `verifierPostureRls`).
 */
export async function verifierDroits(
  interroger: Interrogateur,
  operations: readonly OperationTable[],
): Promise<Probleme[]> {
  const paires = dedoublonnerParTableEtPrivilege(operations);
  const problemes: Probleme[] = [];
  const existenceTable = new Map<string, boolean>();

  for (const [, op] of paires) {
    let existe = existenceTable.get(op.table);
    if (existe === undefined) {
      const resultat = await interroger('select to_regclass($1) is not null as existe', [
        `public.${op.table}`,
      ]);
      existe = (resultat.rows[0] as { existe: boolean }).existe;
      existenceTable.set(op.table, existe);
      if (!existe) {
        problemes.push({ type: 'table-absente', table: op.table, exemple: op });
      }
    }
    if (!existe) continue;

    const resultat = await interroger('select has_table_privilege($1, $2) as autorise', [
      `public.${op.table}`,
      op.privilege,
    ]);
    const autorise = (resultat.rows[0] as { autorise: boolean }).autorise;
    if (!autorise) {
      problemes.push({
        type: 'droit-manquant',
        table: op.table,
        privilege: op.privilege,
        exemple: op,
      });
    }
  }

  return problemes;
}

export function formaterProblemes(problemes: readonly Probleme[]): string {
  return problemes
    .map((p) =>
      p.type === 'table-absente'
        ? `  - table "${p.table}" référencée par le code (${p.exemple.fichier}:${p.exemple.ligne}) ` +
          `mais absente du schéma migré`
        : `  - ${p.privilege} sur "${p.table}" requis par le code (${p.exemple.fichier}:${p.exemple.ligne}) ` +
          `mais non accordé à dfa_app`,
    )
    .join('\n');
}

// -------------------------------------------------------------------------------------------
// Volontairement PAS de CLI/`principal()` ici : ce module reste une pure bibliothèque
// (extraction + croisement), sans dépendance à `pg`. Deux raisons :
//   1. Un `import('pg')` depuis ce fichier serait résolu par TypeScript relativement à SON
//      emplacement physique (`scripts/`, hors `apps/api/`) — pas au contexte `apps/api` qui
//      déclare réellement cette dépendance. Constaté à l'essai (`pnpm typecheck`) : TS2307
//      « Cannot find module 'pg' ». `scripts/appliquer-migrations-increment.ts` évite le même
//      piège en import ANT du code depuis `apps/api/src` plutôt qu'en import ANT un paquet npm
//      directement depuis `scripts/` — mais cette tâche a besoin de l'inverse (le TEST, dans
//      `apps/api/`, importe CE module), donc l'esquive ne s'applique pas ici : la seule issue
//      propre est de ne jamais importer `pg` depuis ce fichier.
//   2. Le garde-fou RÉEL est `apps/api/test/integration/db/droits-sql.spec.ts` — il réutilise le
//      harnais testcontainers déjà éprouvé (`postgres-ephemere.ts`) plutôt qu'une connexion à une
//      base pré-existante dont la posture ne serait pas garantie identique à la prod (voir §3 de
//      l'en-tête). Une CLI ad hoc contre une base déjà migrée n'apporte rien que ce test ne fasse
//      déjà plus fidèlement.
// -------------------------------------------------------------------------------------------
