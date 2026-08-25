/**
 * Adaptateur RÉEL de `PortLecteurArchiveReprise` — branche les fonctions pures/I-O de
 * `apps/api/src/reprise/lecteurs/` (bibliothèque de reconnaissance/lecture DBF/Access, sans
 * dépendance Nest) sur le port attendu par `analyse/service-analyse-reprise.ts` et
 * `import/service-import-reprise.ts`. Remplace `AdaptateurLecteurArchiveRepriseFactice`
 * (réservé aux tests) comme provider RÉEL de `JETON_LECTEUR_ARCHIVE_REPRISE`.
 *
 * FRONTIÈRE DE TYPES — raison d'être de ce fichier (voir aussi l'en-tête de
 * `port-lecteur-archive-reprise.ts`) : `lecteurs/` parle un vocabulaire INTERNE
 * (`FamilleMoteur = 'access' | 'foxpro-dbase' | 'inconnu'`), le port et tout le reste du module
 * parlent le CONTRAT PARTAGÉ (`FamilleMoteurSourceReprise`, `@dfa/shared`). La conversion se fait
 * ICI, dans les deux sens (`versContrat`/`versLecteurs`) — rien d'interne ne fuit au-delà de ce
 * fichier.
 *
 * DÉCOMPRESSION D'ARCHIVE — trou comblé ici, absent de `lecteurs/` (bibliothèque de
 * RECONNAISSANCE/LECTURE de tables déjà extraites, pas de désarchivage) et absent du contrat gelé
 * (aucun format d'archive n'y est spécifié). Hypothèse retenue, la plus probable au vu des DMS
 * visés (Auto-i, Nextlane — export d'un dossier de données en un seul fichier) et du seul format
 * pour lequel une bibliothèque de lecture pure Node existe déjà en dépendance (`yauzl`, ajoutée
 * par cet agent) : l'archive déposée est un **ZIP**. AMBIGUÏTÉ SIGNALÉE, PAS ARBITRÉE PAR UNE
 * SPEC : à confirmer avec `expert-migration-donnees`/@laupernoe si un garage réel livre un `.tar`/`.7z`/
 * `.rar` — l'échec serait alors un `ResultatDetectionFamille` `inconnu` avec anomalie
 * `archive_partiellement_corrompue` (filet déjà posé par `service-analyse-reprise.executer`),
 * jamais un crash silencieux.
 *
 * DÉCOMPTE RÉEL DE LIGNES (`evaluerRole`) — `evaluerRoleTable` (lecteurs/) rend
 * `lignesActives = échantillon.length` (borné, ex. 500) : correct pour la CLASSIFICATION de rôle,
 * FAUX pour `TableDetecteeReprise.nombreLignes` (`volumeAttenduLignes` du plan proposé au
 * garagiste — voir `plan/generation-plan-reprise.ts`). Ce champ est ICI RÉÉCRIT avec le total
 * RÉEL (`compterLignes`, déjà documenté comme servant « au volume attendu du plan » par le port
 * lui-même) avant d'être rendu à l'appelant — sans quoi le plan afficherait la taille de
 * l'échantillon, jamais celle de la table.
 *
 * LIENS INTER-TABLES (`detecterLiens`) — la fonction pure `lecteurs/liens.ts::detecterLiens`
 * prend un LOT de tables déjà échantillonnées, pas une paire ponctuelle : ce fichier maintient un
 * cache borné (LRU simple, `MAX_ENTREES_CACHE_ECHANTILLONS`) des échantillons déjà lus pendant la
 * session d'analyse courante, et exécute la détection sur tout ce qui est disponible au moment de
 * l'appel — les tables pas encore visitées (ordre de parcours du service appelant) ne peuvent
 * mécaniquement pas être candidates. Cache borné et non par-session : ce provider est un
 * SINGLETON Nest (partagé entre tenants/dossiers), jamais réinitialisé explicitement.
 *
 * COMPTAGE ACCESS — `lecteurs/` n'exporte pas d'équivalent `compterLignesActivesDbf` pour Access
 * (aucun `mdb-tables -S`/équivalent exposé) : ce fichier compte en consommant `lireLignesAccess`
 * jusqu'au bout (flux, jamais bufférisé, mais O(n) sur la table entière — plus coûteux que le
 * comptage DBF qui ne lit qu'un octet de statut par enregistrement). Documenté, pas caché.
 */

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, open as ouvrirFichier } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { openPromise, type Entry } from 'yauzl';

import type { FamilleMoteurSourceReprise } from '@dfa/shared';

import {
  analyserEnTeteDbf,
  compterLignesActivesDbf,
  dateMaxPlausibleTable,
  detecterFamilleRepertoire,
  detecterLiens as detecterLiensPur,
  evaluerRoleTable,
  lireLignesAccess,
  lireLignesDbf,
  listerColonnesAccess,
  listerTablesAccess,
  profilerColonnes as profilerColonnesPur,
  sniffFamilleFichier,
} from '../lecteurs';
import type { FamilleMoteur as FamilleMoteurLecteurs, LigneTable } from '../lecteurs/types';
import type { TableEchantillonnee } from '../lecteurs/liens';

import type {
  FichierArchiveSource,
  LienCandidat,
  OptionsLectureDbf,
  PortLecteurArchiveReprise,
  ProfilColonne,
  RapportTable,
  ResultatDetectionFamilleReprise,
} from './port-lecteur-archive-reprise';

const LIMITE_ECHANTILLON_DEFAUT = 500;
const MAX_ENTREES_CACHE_ECHANTILLONS = 500;
const TAILLE_SONDE_FAMILLE_OCTETS = 8192;

const FAMILLE_VERS_CONTRAT: Readonly<Record<FamilleMoteurLecteurs, FamilleMoteurSourceReprise>> = {
  access: 'access_jet',
  'foxpro-dbase': 'foxpro_dbf',
  inconnu: 'inconnu',
};

const FAMILLE_VERS_LECTEURS: Readonly<
  Partial<Record<FamilleMoteurSourceReprise, FamilleMoteurLecteurs>>
> = {
  access_jet: 'access',
  foxpro_dbf: 'foxpro-dbase',
  inconnu: 'inconnu',
};

function versContrat(famille: FamilleMoteurLecteurs): FamilleMoteurSourceReprise {
  return FAMILLE_VERS_CONTRAT[famille];
}

/** @throws {Error} pour une famille du contrat que `lecteurs/` ne sait pas encore lire
 *  (`sql_server`/`mysql`/`sqlite`/`fichier_plat_delimite` — voir l'en-tête de `TOUTES_ACTIONS`
 *  dans `contrats/reprise.ts` : extensions futures anticipées, pas encore implémentées). */
function versLecteurs(famille: FamilleMoteurSourceReprise): FamilleMoteurLecteurs {
  const trouvee = FAMILLE_VERS_LECTEURS[famille];
  if (!trouvee) {
    throw new Error(
      `AdaptateurLecteurArchiveReprise : famille "${famille}" non lisible par lecteurs/ (Access/FoxPro seulement à ce jour).`,
    );
  }
  return trouvee;
}

/** Exportée pour test direct (zip-slip) — les bibliothèques d'écriture de ZIP couramment
 *  utilisées en fixture de test (`yazl`) refusent elles-mêmes de PRODUIRE un chemin `..`/absolu,
 *  ce qui rend impossible de fabriquer une archive malveillante réaliste pour un test de bout en
 *  bout : cette garde est donc prouvée isolément, sur les mêmes chaînes qu'un lecteur de zip
 *  tolérant (contrairement à `yazl`) laisserait passer. */
export function estCheminZipDangereux(nomEntree: string): boolean {
  if (nomEntree.startsWith('/') || nomEntree.startsWith('\\') || nomEntree.includes('\0')) {
    return true;
  }
  return nomEntree.split(/[/\\]/).includes('..');
}

function estRepertoireEntreeZip(entree: Entry): boolean {
  return /[/\\]$/.test(entree.fileName);
}

/** Cache borné (LRU par ordre d'insertion) — voir « LIENS INTER-TABLES » en tête de fichier. */
class CacheEchantillons {
  private readonly parCle = new Map<string, TableEchantillonnee>();

  obtenir(cle: string): TableEchantillonnee | undefined {
    return this.parCle.get(cle);
  }

  poser(cle: string, valeur: TableEchantillonnee): void {
    this.parCle.delete(cle);
    this.parCle.set(cle, valeur);
    while (this.parCle.size > MAX_ENTREES_CACHE_ECHANTILLONS) {
      const plusAncienne = this.parCle.keys().next().value;
      if (plusAncienne === undefined) break;
      this.parCle.delete(plusAncienne);
    }
  }

  toutes(): TableEchantillonnee[] {
    return [...this.parCle.values()];
  }
}

// PAS de `@Injectable()` ICI — DÉLIBÉRÉ, piège vérifié EN EXÉCUTION (`nest start`, réel, pas
// seulement `tsc`) : ce décorateur déclenche l'émission `design:paramtypes` par TypeScript, et
// Nest tente alors de résoudre `racineTravail` (type `string`) comme un jeton DI réel — échec
// `UnknownDependenciesException` (« argument String at index [0] »), le module refuse de
// démarrer. Sans décorateur, TypeScript n'émet AUCUNE métadonnée de constructeur : Nest
// instancie avec `new AdaptateurLecteurArchiveReprise()`, la valeur par défaut du paramètre
// s'applique normalement — MÊME PATRON que `StockageArchiveRepriseDisqueLocal`
// (`depot/stockage-archive-reprise.ts`), déjà posé sans `@Injectable()` pour la même raison,
// enregistré via `useClass` dans `reprise.module.ts` exactement comme cette classe.
export class AdaptateurLecteurArchiveReprise implements PortLecteurArchiveReprise {
  private readonly racineTravail: string;
  private readonly cache = new CacheEchantillons();

  constructor(racineTravail: string = join(process.cwd(), 'uploads', 'reprise-extraction')) {
    this.racineTravail = racineTravail;
  }

  // --- Décompression + inventaire ---------------------------------------------------------------

  async extraireEtInventorier(
    cheminArchive: string,
  ): Promise<{ readonly repertoire: string; readonly fichiers: readonly FichierArchiveSource[] }> {
    await mkdir(this.racineTravail, { recursive: true });
    const repertoire = await mkdtemp(join(this.racineTravail, 'extrait-'));
    const fichiers = await this.extraireZip(cheminArchive, repertoire);
    return { repertoire, fichiers };
  }

  private async extraireZip(
    cheminArchive: string,
    repertoireDestination: string,
  ): Promise<FichierArchiveSource[]> {
    const fichiers: FichierArchiveSource[] = [];
    const zipfile = await openPromise(cheminArchive, { lazyEntries: true, autoClose: true });
    try {
      for await (const entree of zipfile.eachEntry()) {
        if (estCheminZipDangereux(entree.fileName)) {
          // Entrée hors de la racine d'extraction (zip-slip) ou chemin absolu : ignorée, jamais
          // écrite sur disque — signalée comme fichier illisible plutôt que silencieusement omise.
          fichiers.push({
            chemin: join(repertoireDestination, entree.fileName.replace(/^[/\\]+/, '')),
            tailleOctets: 0,
            lisible: false,
            empreinteSha256: null,
          });
          continue;
        }

        const cheminDestination = resolve(repertoireDestination, entree.fileName);

        if (estRepertoireEntreeZip(entree)) {
          await mkdir(cheminDestination, { recursive: true });
          continue;
        }

        await mkdir(dirname(cheminDestination), { recursive: true });
        fichiers.push(await this.ecrireEntreeZip(zipfile, entree, cheminDestination));
      }
    } finally {
      zipfile.close();
    }
    return fichiers;
  }

  private async ecrireEntreeZip(
    zipfile: Awaited<ReturnType<typeof openPromise>>,
    entree: Entry,
    cheminDestination: string,
  ): Promise<FichierArchiveSource> {
    try {
      const flux = await zipfile.openReadStreamPromise(entree);
      const hash = createHash('sha256');
      let taille = 0;
      flux.on('data', (morceau: Buffer) => {
        hash.update(morceau);
        taille += morceau.length;
      });
      await pipeline(flux, createWriteStream(cheminDestination));
      return {
        chemin: cheminDestination,
        tailleOctets: taille,
        lisible: true,
        empreinteSha256: hash.digest('hex'),
      };
    } catch {
      // Entrée corrompue (CRC invalide, flux tronqué...) : fichier illisible, jamais fatal pour
      // le reste de l'archive — voir la doctrine identique de `lecteurs/detection-famille.ts`.
      return { chemin: cheminDestination, tailleOctets: 0, lisible: false, empreinteSha256: null };
    }
  }

  // --- Reconnaissance de famille -------------------------------------------------------------

  async detecterFamille(cheminRepertoireExtrait: string): Promise<ResultatDetectionFamilleReprise> {
    const resultat = await detecterFamilleRepertoire(cheminRepertoireExtrait);
    return { ...resultat, famille: versContrat(resultat.famille) };
  }

  private async detecterFamilleFichier(cheminFichier: string): Promise<FamilleMoteurLecteurs> {
    const fd = await ouvrirFichier(cheminFichier, 'r');
    try {
      const tampon = Buffer.alloc(TAILLE_SONDE_FAMILLE_OCTETS);
      const { bytesRead } = await fd.read(tampon, 0, TAILLE_SONDE_FAMILLE_OCTETS, 0);
      return sniffFamilleFichier(tampon.subarray(0, bytesRead));
    } finally {
      await fd.close();
    }
  }

  // --- Copie faisant foi ------------------------------------------------------------------------

  /**
   * GRANULARITÉ DIFFÉRENTE de `lecteurs/choix-copie-source.ts::choisirCopieSourceDeVerite`
   * (qui compare des RÉPERTOIRES entiers de copies rivales, avec un résumé par table déjà
   * construit par l'appelant) : ce port compare des FICHIERS candidats pour UNE MÊME table
   * logique. Réimplémentation légère mais fidèle à la même doctrine (jamais sur le chemin/nom,
   * uniquement sur le contenu mesuré) : la copie retenue est celle dont la donnée la plus
   * récente plausible est la plus fraîche, départagée par le volume total de lignes actives.
   */
  async choisirCopieFaisantFoi(candidats: readonly string[]): Promise<string | null> {
    if (candidats.length === 0) return null;
    if (candidats.length === 1) return candidats[0]!;

    const notes: { chemin: string; dateMax: number; total: number }[] = [];

    for (const chemin of candidats) {
      const familleLecteurs = await this.detecterFamilleFichier(chemin);
      if (familleLecteurs === 'inconnu') continue;
      const famille = versContrat(familleLecteurs);
      let total = 0;
      let dateMax = -Infinity;
      for (const table of await this.listerTables(chemin, famille)) {
        const echantillon = await this.obtenirEchantillon(chemin, famille, table);
        total += await this.compterLignes(chemin, famille, table);
        const d = dateMaxPlausibleTable(echantillon.colonnes, echantillon.lignes);
        if (d && d.getTime() > dateMax) dateMax = d.getTime();
      }
      notes.push({ chemin, dateMax, total });
    }

    if (notes.length === 0) return candidats[0] ?? null;
    notes.sort((a, b) => b.dateMax - a.dateMax || b.total - a.total);
    return notes[0]!.chemin;
  }

  // --- Tables --------------------------------------------------------------------------------

  async listerTables(
    cheminFichier: string,
    famille: FamilleMoteurSourceReprise,
  ): Promise<readonly string[]> {
    const familleLecteurs = versLecteurs(famille);
    if (familleLecteurs === 'access') {
      if (!/\.(mdb|accdb)$/i.test(cheminFichier)) return [];
      return listerTablesAccess(cheminFichier);
    }
    if (familleLecteurs === 'foxpro-dbase') {
      if (!/\.dbf$/i.test(cheminFichier)) return [];
      try {
        await analyserEnTeteDbf(cheminFichier);
      } catch {
        return []; // en-tête invalide : ce .dbf précis est ignoré, jamais fatal pour l'archive
      }
      return [nomTableDepuisChemin(cheminFichier)];
    }
    return [];
  }

  async evaluerRole(
    cheminFichier: string,
    famille: FamilleMoteurSourceReprise,
    table: string,
  ): Promise<RapportTable> {
    const echantillon = await this.obtenirEchantillon(cheminFichier, famille, table);
    const rapport = evaluerRoleTable({
      table,
      nomsColonnes: echantillon.colonnes,
      lignesActives: echantillon.lignes,
    });
    // Réécrit avec le total RÉEL — voir « DÉCOMPTE RÉEL DE LIGNES » en tête de fichier.
    const total = await this.compterLignes(cheminFichier, famille, table);
    return { ...rapport, lignesActives: total };
  }

  async profilerColonnes(
    cheminFichier: string,
    famille: FamilleMoteurSourceReprise,
    table: string,
  ): Promise<readonly ProfilColonne[]> {
    const echantillon = await this.obtenirEchantillon(cheminFichier, famille, table);
    return profilerColonnesPur(echantillon.colonnes, echantillon.lignes);
  }

  async detecterLiens(
    cheminFichier: string,
    famille: FamilleMoteurSourceReprise,
    table: string,
  ): Promise<readonly LienCandidat[]> {
    await this.obtenirEchantillon(cheminFichier, famille, table); // s'assure que `table` est en cache
    const liens = detecterLiensPur(this.cache.toutes());
    return liens.filter((l) => l.tableSource === table || l.tableCible === table);
  }

  async *lireLignes(
    cheminFichier: string,
    famille: FamilleMoteurSourceReprise,
    table: string,
    options?: OptionsLectureDbf,
  ): AsyncIterable<LigneTable> {
    const familleLecteurs = versLecteurs(famille);
    if (familleLecteurs === 'access') {
      yield* lireLignesAccess(cheminFichier, table, options);
      return;
    }
    if (familleLecteurs === 'foxpro-dbase') {
      yield* lireLignesDbf(cheminFichier, options);
      return;
    }
  }

  async compterLignes(
    cheminFichier: string,
    famille: FamilleMoteurSourceReprise,
    table: string,
  ): Promise<number> {
    const familleLecteurs = versLecteurs(famille);
    if (familleLecteurs === 'foxpro-dbase') {
      return compterLignesActivesDbf(cheminFichier);
    }
    if (familleLecteurs === 'access') {
      let n = 0;
      for await (const _ligne of lireLignesAccess(cheminFichier, table)) n++;
      return n;
    }
    return 0;
  }

  // --- Échantillonnage partagé (évaluation de rôle / profilage / liens) ----------------------

  private async obtenirEchantillon(
    cheminFichier: string,
    famille: FamilleMoteurSourceReprise,
    table: string,
  ): Promise<TableEchantillonnee> {
    const cle = `${cheminFichier}::${table}`;
    const enCache = this.cache.obtenir(cle);
    if (enCache) return enCache;

    const familleLecteurs = versLecteurs(famille);
    let colonnes: readonly string[];
    let lignes: LigneTable[];

    if (familleLecteurs === 'access') {
      colonnes = await listerColonnesAccess(cheminFichier, table);
      lignes = [];
      for await (const ligne of lireLignesAccess(cheminFichier, table, {
        limite: LIMITE_ECHANTILLON_DEFAUT,
      })) {
        lignes.push(ligne);
      }
    } else if (familleLecteurs === 'foxpro-dbase') {
      const entete = await analyserEnTeteDbf(cheminFichier);
      colonnes = entete.champs.map((c) => c.nom);
      lignes = [];
      for await (const ligne of lireLignesDbf(cheminFichier, {
        limite: LIMITE_ECHANTILLON_DEFAUT,
      })) {
        lignes.push(ligne);
      }
    } else {
      colonnes = [];
      lignes = [];
    }

    const echantillon: TableEchantillonnee = { nom: table, colonnes, lignes };
    this.cache.poser(cle, echantillon);
    return echantillon;
  }
}

function nomTableDepuisChemin(cheminFichier: string): string {
  const base = cheminFichier.split(sep).pop() ?? cheminFichier;
  const ext = extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}
