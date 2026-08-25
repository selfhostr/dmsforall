import { parse } from 'csv-parse';
import type { LigneTable, OptionsLectureDbf, ValeurChamp } from '../types';
import {
  ErreurDelaiDepasseProcessus,
  ErreurLectureAccess,
  ErreurOutilAccesIndisponible,
} from '../erreurs';
import {
  executerCommandeCapturee,
  fabriqueProcessusReelle,
  type FabriqueProcessus,
  type ProcessusExecute,
} from './executeur-processus';

/**
 * `mdb-export` est un flux, potentiellement TRÈS long sur une table légitime volumineuse (mesuré
 * réel : 6,7 millions de lignes exportées en ~98 s, ~68 000 lignes/s soutenu, sur une base Access
 * de 1,4 Go) — un délai ABSOLU court casserait ce cas réel. Deux gardes DISTINCTES, pas une seule :
 *
 *   - INACTIVITÉ (`DELAI_INACTIVITE_EXPORT_MS`) — aucun octet reçu depuis ce délai. C'est la garde
 *     qui répond exactement à la menace mesurée (un `.mdb` forgé qui fait boucler `mdbtools` SANS
 *     jamais produire de sortie) : au débit soutenu mesuré, une table légitime ne connaît aucun
 *     silence de cette durée, même sous charge I/O dégradée.
 *   - PLAFOND ABSOLU (`DELAI_ABSOLU_EXPORT_MS`) — filet de sécurité contre un flux qui produirait
 *     un filet d'octets en continu sans jamais se terminer (contournerait une garde d'inactivité
 *     seule). Extrapolé du débit mesuré (68 000 lignes/s) : 2 h couvrent plus de 480 millions de
 *     lignes en continu, largement au-delà du plus gros référentiel réel connu du dépôt (9,4
 *     millions de lignes).
 */
export const DELAI_INACTIVITE_EXPORT_MS = 5 * 60 * 1000;
export const DELAI_ABSOLU_EXPORT_MS = 2 * 60 * 60 * 1000;
const DELAI_ESCALADE_SIGKILL_EXPORT_MS = 5_000;

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
      // `--table=<valeur>` (forme à UN SEUL token), jamais `['--table', table]` (deux tokens) :
      // `table` vient du contenu de l'archive DÉPOSÉE PAR LE GARAGISTE, jamais validé en amont —
      // un nom commençant par `-` glissé comme second token pourrait être repris pour un nouveau
      // flag par l'analyseur d'options plutôt que consommé comme valeur (finding sécurité, gravité
      // basse : pas d'injection, `spawn` reçoit un tableau d'arguments jamais un shell — mais un
      // comportement imprévisible). La forme `=` rend la valeur INSÉCABLE de son option, quel que
      // soit son contenu.
      [`--table=${table}`, cheminMdb],
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

export interface OptionsLectureAccess extends OptionsLectureDbf, OptionsAccess {
  /** Override de test — voir `DELAI_INACTIVITE_EXPORT_MS` en tête de fichier. */
  delaiInactiviteExportMs?: number;
  /** Override de test — voir `DELAI_ABSOLU_EXPORT_MS` en tête de fichier. */
  delaiAbsoluExportMs?: number;
  /** Override de test — délai de grâce avant `SIGKILL` si `SIGTERM` est ignoré. */
  delaiEscaladeSigkillMs?: number;
}

/**
 * Itère les lignes d'une table Access en flux, via `mdb-export | csv-parse` — jamais de
 * bufferisation intégrale, y compris sur une table de plusieurs millions de lignes.
 *
 * `mdb-export` ne distingue pas NULL d'une chaîne vide dans son export CSV (limite connue,
 * documentée dans le rapport de livraison) : les deux ressortent ici en `null`.
 *
 * @throws {ErreurOutilAccesIndisponible} si `mdb-export` est absent (ENOENT).
 * @throws {ErreurLectureAccess} en cas d'échec de `mdb-export` (table absente, fichier corrompu, ...).
 * @throws {ErreurDelaiDepasseProcessus} si `mdb-export` ne produit plus rien pendant
 *   `delaiInactiviteExportMs`, ou dépasse `delaiAbsoluExportMs` au total — le sous-processus est
 *   explicitement terminé (`SIGTERM` puis `SIGKILL`) avant que l'erreur ne soit levée.
 */
export async function* lireLignesAccess(
  cheminMdb: string,
  table: string,
  options: OptionsLectureAccess = {},
): AsyncGenerator<LigneTable, void, void> {
  const fabrique = options.fabriqueProcessus ?? fabriqueProcessusReelle;
  // `--` : séparateur de fin d'options — `table` vient du contenu de l'archive DÉPOSÉE PAR LE
  // GARAGISTE, jamais validé en amont. Sans lui, un nom de table commençant par `-` en position
  // finale pourrait être repris par l'analyseur d'options de `mdb-export` plutôt que consommé
  // comme argument positionnel (finding sécurité, gravité basse — pas d'injection, `spawn` reçoit
  // un tableau d'arguments jamais un shell, mais un comportement imprévisible). Vérifié en
  // exécution réelle (`mdb-export ... -- "-Marken"` reste un échec PROPRE et déterministe côté
  // mdbtools, jamais une réinterprétation en option).
  const args = ['-D', '%Y-%m-%d', '-T', '%Y-%m-%d %H:%M:%S', cheminMdb, '--', table];

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

  // --- Délai dur (finding sécurité : un `.mdb` forgé qui fait boucler `mdbtools` occupait un
  // slot de worker BullMQ indéfiniment, bloquant la file pour TOUS les tenants) — voir l'en-tête
  // du fichier pour la justification MESURÉE des deux seuils. `erreurDelai` distingue une
  // terminaison VOULUE (dépassement) d'une fin de flux normale ou d'une sortie anticipée
  // d'échantillonnage, pour ne jamais les confondre dans les vérifications ci-dessous.
  const delaiInactiviteMs = options.delaiInactiviteExportMs ?? DELAI_INACTIVITE_EXPORT_MS;
  const delaiAbsoluMs = options.delaiAbsoluExportMs ?? DELAI_ABSOLU_EXPORT_MS;
  const delaiEscaladeMs = options.delaiEscaladeSigkillMs ?? DELAI_ESCALADE_SIGKILL_EXPORT_MS;

  let erreurDelai: ErreurDelaiDepasseProcessus | null = null;
  // Initialisées à `undefined` (pas seulement typées `| undefined`) : l'assignation réelle se
  // fait par EFFET DE BORD dans `armerInactivite` (fermeture), qu'une analyse d'assignation
  // définie de TypeScript ne peut pas suivre à travers un appel de fonction indirect.
  let minuteurInactivite: NodeJS.Timeout | undefined = undefined;
  let minuteurAbsolu: NodeJS.Timeout | undefined = undefined;

  function surDelaiDepasse(motif: 'inactivite' | 'absolu', delaiMs: number): void {
    if (erreurDelai) return; // déjà déclenché par l'autre garde — un seul déclenchement compte
    erreurDelai = new ErreurDelaiDepasseProcessus(
      'mdb-export',
      `${cheminMdb} :: ${table}`,
      motif,
      delaiMs,
    );
    clearTimeout(minuteurInactivite);
    clearTimeout(minuteurAbsolu);
    processus.kill?.('SIGTERM');
    const minuteurSigkill = setTimeout(() => processus.kill?.('SIGKILL'), delaiEscaladeMs);
    minuteurSigkill.unref?.();
    // Débloque un `for await` en attente d'un prochain enregistrement qui ne viendra jamais —
    // sans ceci, un processus qui ne produit AUCUN octet laisse la boucle suspendue pour de bon.
    parseur.destroy(erreurDelai);
  }

  function armerInactivite(): void {
    clearTimeout(minuteurInactivite);
    minuteurInactivite = setTimeout(
      () => surDelaiDepasse('inactivite', delaiInactiviteMs),
      delaiInactiviteMs,
    );
    minuteurInactivite.unref?.();
  }
  armerInactivite();
  processus.stdout.on('data', armerInactivite);
  minuteurAbsolu = setTimeout(() => surDelaiDepasse('absolu', delaiAbsoluMs), delaiAbsoluMs);
  minuteurAbsolu.unref?.();

  let rendus = 0;
  let index = 0;
  let sortieAnticipee = false;

  try {
    for await (const enregistrement of parseur as AsyncIterable<Record<string, string>>) {
      if (erreurSpawn) throw erreurSpawn as ErreurOutilAccesIndisponible;
      if (erreurDelai) throw erreurDelai as ErreurDelaiDepasseProcessus;

      const valeurs: Record<string, ValeurChamp> = {};
      for (const [cle, valeur] of Object.entries(enregistrement)) {
        valeurs[cle] = valeur === '' ? null : valeur;
      }
      yield { index, valeurs };
      index++;
      rendus++;

      if (options.limite !== undefined && rendus >= options.limite) {
        sortieAnticipee = true;
        clearTimeout(minuteurInactivite);
        clearTimeout(minuteurAbsolu);
        parseur.destroy();
        processus.kill?.();
        break;
      }
    }
  } catch (erreur) {
    if (erreur instanceof ErreurOutilAccesIndisponible) throw erreur;
    if (erreur instanceof ErreurDelaiDepasseProcessus) throw erreur;
    // Le flux peut se rompre si le sous-processus meurt en cours d'écriture : diagnostiquer
    // via stderr plutôt que de laisser fuiter une erreur de flux Node opaque.
    throw new ErreurLectureAccess(cheminMdb, table, messageErreur(erreur));
  } finally {
    clearTimeout(minuteurInactivite);
    clearTimeout(minuteurAbsolu);
  }

  if (erreurSpawn) throw erreurSpawn as ErreurOutilAccesIndisponible;
  if (erreurDelai) throw erreurDelai as ErreurDelaiDepasseProcessus;

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
