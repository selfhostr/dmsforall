import { parse } from 'csv-parse';
import type { LigneTable, OptionsLectureDbf, ValeurChamp } from '../types';
import { ErreurLectureAccess, ErreurOutilAccesIndisponible } from '../erreurs';
import {
  executerCommandeCapturee,
  fabriqueProcessusReelle,
  type FabriqueProcessus,
  type ProcessusExecute,
} from './executeur-processus';

export interface OptionsAccess {
  fabriqueProcessus?: FabriqueProcessus;
  /**
   * Charset des fichiers Jet3/Access 97 hérités (`MDB_JET3_CHARSET`). Sans effet sur les
   * fichiers Jet4/.accdb récents, qui embarquent leur propre codepage — mesuré sur archive
   * réelle : mdbtools le détecte alors correctement sans intervention.
   */
  charsetJet3?: string;
}

const CHARSET_JET3_PAR_DEFAUT = 'CP1252'; // défaut Windows suisse pour les bases Access 97 héritées

function construireEnvironnement(options?: OptionsAccess): NodeJS.ProcessEnv {
  return {
    ...process.env,
    MDBICONV: 'UTF-8', // sortie déterministe, indépendante de la locale du conteneur
    MDB_JET3_CHARSET: options?.charsetJet3 ?? CHARSET_JET3_PAR_DEFAUT,
  };
}

function messageErreur(erreur: unknown): string {
  if (erreur instanceof Error) return erreur.message;
  return String(erreur);
}

/**
 * Vérifie la présence de `mdbtools` sans jamais planter si le binaire est absent — c'est un
 * outil système ajouté à l'image Docker par un autre chantier ; cette bibliothèque doit rester
 * fonctionnelle (famille inconnue plutôt que crash) tant qu'il n'est pas encore là.
 */
export async function verifierMdbToolsDisponible(
  options?: OptionsAccess,
): Promise<{ disponible: boolean; version?: string; motif?: string }> {
  const fabrique = options?.fabriqueProcessus ?? fabriqueProcessusReelle;
  try {
    const sortie = await executerCommandeCapturee(fabrique, 'mdb-tables', ['--version']);
    if (sortie.codeSortie !== 0) {
      return {
        disponible: false,
        motif: `code de sortie ${sortie.codeSortie} : ${sortie.stderr.toString('utf-8').trim()}`,
      };
    }
    return { disponible: true, version: sortie.stdout.toString('utf-8').trim() };
  } catch (erreur) {
    return { disponible: false, motif: messageErreur(erreur) };
  }
}

/** Liste les tables utilisateur d'une base Access (tables système exclues). */
export async function listerTablesAccess(
  cheminMdb: string,
  options?: OptionsAccess,
): Promise<string[]> {
  const fabrique = options?.fabriqueProcessus ?? fabriqueProcessusReelle;
  let sortie;
  try {
    sortie = await executerCommandeCapturee(
      fabrique,
      'mdb-tables',
      ['-1', cheminMdb],
      construireEnvironnement(options),
    );
  } catch (erreur) {
    throw new ErreurOutilAccesIndisponible(messageErreur(erreur));
  }
  if (sortie.codeSortie !== 0) {
    throw new ErreurLectureAccess(
      cheminMdb,
      '(mdb-tables)',
      sortie.stderr.toString('utf-8').trim(),
    );
  }
  return sortie.stdout
    .toString('utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Liste les colonnes d'une table via `mdb-schema` (fonctionne même sur une table à 0 ligne,
 * contrairement à une lecture d'échantillon via `mdb-export`).
 */
export async function listerColonnesAccess(
  cheminMdb: string,
  table: string,
  options?: OptionsAccess,
): Promise<string[]> {
  const fabrique = options?.fabriqueProcessus ?? fabriqueProcessusReelle;
  let sortie;
  try {
    sortie = await executerCommandeCapturee(
      fabrique,
      'mdb-schema',
      ['--table', table, cheminMdb],
      construireEnvironnement(options),
    );
  } catch (erreur) {
    throw new ErreurOutilAccesIndisponible(messageErreur(erreur));
  }
  if (sortie.codeSortie !== 0) {
    throw new ErreurLectureAccess(cheminMdb, table, sortie.stderr.toString('utf-8').trim());
  }
  return extraireColonnesDdl(sortie.stdout.toString('utf-8'));
}

/**
 * Extrait les noms de colonnes d'un bloc `CREATE TABLE [Nom] ( [Col1] Type, [Col2] Type, ... );`
 * tel qu'émis par `mdb-schema` — format fixe et documenté, analysé ligne à ligne plutôt que via
 * un vrai parseur SQL (hors de propos ici).
 */
function extraireColonnesDdl(ddl: string): string[] {
  const colonnes: string[] = [];
  let dansLeBloc = false;
  for (const ligne of ddl.split('\n')) {
    if (/^CREATE TABLE/.test(ligne.trim())) {
      dansLeBloc = true;
      continue;
    }
    if (!dansLeBloc) continue;
    if (/^\)/.test(ligne.trim())) break;
    const correspondance = /^\s*\[([^\]]+)\]/.exec(ligne);
    if (correspondance) colonnes.push(correspondance[1]!);
  }
  return colonnes;
}

export interface OptionsLectureAccess extends OptionsLectureDbf, OptionsAccess {}

/**
 * Itère les lignes d'une table Access en flux, via `mdb-export | csv-parse` — jamais de
 * bufferisation intégrale, y compris sur une table de plusieurs millions de lignes.
 *
 * `mdb-export` ne distingue pas NULL d'une chaîne vide dans son export CSV (limite connue,
 * documentée dans le rapport de livraison) : les deux ressortent ici en `null`.
 *
 * @throws {ErreurOutilAccesIndisponible} si `mdb-export` est absent (ENOENT).
 * @throws {ErreurLectureAccess} en cas d'échec de `mdb-export` (table absente, fichier corrompu, ...).
 */
export async function* lireLignesAccess(
  cheminMdb: string,
  table: string,
  options: OptionsLectureAccess = {},
): AsyncGenerator<LigneTable, void, void> {
  const fabrique = options.fabriqueProcessus ?? fabriqueProcessusReelle;
  const args = ['-D', '%Y-%m-%d', '-T', '%Y-%m-%d %H:%M:%S', cheminMdb, table];

  let processus: ProcessusExecute;
  try {
    processus = fabrique('mdb-export', args, { env: construireEnvironnement(options) });
  } catch (erreur) {
    throw new ErreurOutilAccesIndisponible(messageErreur(erreur));
  }

  let erreurSpawn: ErreurOutilAccesIndisponible | null = null;
  processus.on('error', (e) => {
    erreurSpawn = new ErreurOutilAccesIndisponible(
      `échec de lancement de mdb-export : ${e.message}`,
    );
  });

  const morceauxStderr: Buffer[] = [];
  processus.stderr.on('data', (d: Buffer) => morceauxStderr.push(d));

  const attenteFermeture = new Promise<number | null>((resolve) => {
    processus.on('close', (code) => resolve(code));
  });

  const parseur = parse({ columns: true, bom: true, relax_column_count: true });
  processus.stdout.pipe(parseur);

  let rendus = 0;
  let index = 0;
  let sortieAnticipee = false;

  try {
    for await (const enregistrement of parseur as AsyncIterable<Record<string, string>>) {
      if (erreurSpawn) throw erreurSpawn as ErreurOutilAccesIndisponible;

      const valeurs: Record<string, ValeurChamp> = {};
      for (const [cle, valeur] of Object.entries(enregistrement)) {
        valeurs[cle] = valeur === '' ? null : valeur;
      }
      yield { index, valeurs };
      index++;
      rendus++;

      if (options.limite !== undefined && rendus >= options.limite) {
        sortieAnticipee = true;
        parseur.destroy();
        processus.kill?.();
        break;
      }
    }
  } catch (erreur) {
    if (erreur instanceof ErreurOutilAccesIndisponible) throw erreur;
    // Le flux peut se rompre si le sous-processus meurt en cours d'écriture : diagnostiquer
    // via stderr plutôt que de laisser fuiter une erreur de flux Node opaque.
    throw new ErreurLectureAccess(cheminMdb, table, messageErreur(erreur));
  }

  if (erreurSpawn) throw erreurSpawn as ErreurOutilAccesIndisponible;

  if (!sortieAnticipee) {
    const codeSortie = await attenteFermeture;
    if (codeSortie !== 0 && codeSortie !== null) {
      throw new ErreurLectureAccess(
        cheminMdb,
        table,
        `mdb-export a échoué (code ${codeSortie}) : ${Buffer.concat(morceauxStderr).toString('utf-8')}`,
      );
    }
  }
}
