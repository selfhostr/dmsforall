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
 *
 * PURGE DU RÉPERTOIRE D'EXTRACTION (finding sécurité HAUTE, nLPD) — `extraireEtInventorier`
 * décompresse des données personnelles EN CLAIR (clients, immatriculations, montants, parfois des
 * dossiers de solvabilité) sous `racineTravail`. Deux mécanismes, DÉLIBÉRÉMENT DISTINCTS :
 *
 *   1. Nettoyage IMMÉDIAT — `purgerRepertoireExtrait` (méthode du port), appelée par les DEUX
 *      appelants (`analyse/service-analyse-reprise.ts`, `import/service-import-reprise.ts`) dans
 *      un `finally`, que le traitement de l'archive réussisse ou échoue. C'est le chemin NORMAL :
 *      un répertoire d'extraction ne doit JAMAIS survivre au traitement qui l'a créé.
 *
 *   2. Balayage des RÉSIDUS DE PLANTAGE — `purgerResidusAnciens`, appelée en tête de CHAQUE
 *      `extraireEtInventorier` (donc à chaque analyse/import, tous tenants confondus), ET (défaut
 *      réel du 26.08.2026, ajouté ici : un serveur qui ne redémarre jamais et n'enchaîne aucune
 *      nouvelle reprise ne bénéficiait sinon d'AUCUNE seconde chance de balayage) en FIN de CHAQUE
 *      `purgerRepertoireExtrait` — donc aussi à la fin de CHAQUE job, succès ou échec, best-effort.
 *      SEUL le `finally` des appelants ne peut PAS couvrir une mort du PROCESSUS worker lui-même
 *      (SIGKILL, OOM) : le répertoire créé par le `mkdtemp` en cours reste alors orphelin, sans
 *      qu'aucun code applicatif n'ait la main pour le nettoyer.
 *
 *      DEUX OPTIONS PESÉES (brief) : (a) rendre le chemin DÉRIVABLE du tenant/dossier pour le
 *      rattacher au même geste que `ServiceCycleVieResiliation.purger` (commit `8970bbb`,
 *      `dossier_reprise.stockage_chemin`) ; (b) un balayage des résidus, indépendant de la
 *      résiliation. CHOIX RETENU : (b), pour trois raisons pesées explicitement.
 *        - PÉRIMÈTRE : (a) exigerait de modifier `exploitation/cycle-vie-tenant/` — un AUTRE
 *          agent y écrit EN CE MOMENT MÊME sur cette même branche ; y toucher serait soit une
 *          collision d'écriture, soit un couplage figé par écrit sans l'accord de son
 *          propriétaire.
 *        - COUVERTURE RÉELLEMENT PLUS LARGE : (a) ne protège qu'au moment de la RÉSILIATION d'un
 *          tenant — un plantage en pleine analyse d'un tenant ACTIF (le cas de loin le plus
 *          fréquent, aucun rapport avec une résiliation) laisserait le résidu prospérer jusqu'à
 *          la résiliation, potentiellement des mois plus tard. (b) borne l'exposition à
 *          `DUREE_MAX_RESIDU_EXTRACTION_MS` pour TOUT résidu, de tout tenant, quel que soit son
 *          statut.
 *        - ROBUSTESSE : `racineTravail` est déjà une racine PARTAGÉE (singleton Nest, tous
 *          tenants confondus, voir plus bas) — un balayage à cet endroit n'a besoin d'aucune
 *          information tenant/dossier pour être correct, contrairement à une dérivation de
 *          chemin qui devrait rester cohérente avec la construction ET la purge de résiliation.
 *
 *      SEUIL (`DUREE_MAX_RESIDU_EXTRACTION_MS`, 3 h) : voir sa justification propre ci-dessous,
 *      ancrée sur le débit d'export MESURÉ (`lecteurs/access/lecteur-access.ts`).
 *
 *   3. Balayage INCONDITIONNEL au DÉMARRAGE du process (`onModuleInit`, défaut réel du 25.08.2026)
 *      — le mécanisme (2) borne l'exposition à 3 h, mais seulement en tête du PROCHAIN
 *      `extraireEtInventorier` : sans nouvelle analyse/import (n'importe quel tenant), un résidu
 *      de plantage — précisément le scénario mesuré ce jour-là (transaction Postgres tuée en
 *      cours d'extraction, `uncaughtException` -> `process.exit(1)`, `finally` de l'appelant
 *      jamais exécuté) — pouvait survivre INDÉFINIMENT sur disque, données personnelles en clair
 *      comprises (4,6 Go mesurés, deux copies complètes de l'archive, supprimées à la main faute
 *      de ce mécanisme). Au redémarrage du process, AUCUNE extraction de CE process n'est encore
 *      en cours : tout répertoire déjà présent sous `racineTravail` est nécessairement un résidu
 *      d'une exécution PRÉCÉDENTE, purgé sans condition d'âge — voir `purgerResidusOrphelinsAuDemarrage`.
 */

import type { OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createWriteStream, type Dirent } from 'node:fs';
import { mkdir, mkdtemp, open as ouvrirFichier, readdir, rm, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { openPromise, type Entry } from 'yauzl';

import type { FamilleMoteurSourceReprise } from '@dfa/shared';

import { creerCedeurEventLoop } from '../../common/concurrence';

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

import {
  ErreurLimiteExtractionDepassee,
  type FichierArchiveSource,
  type LienCandidat,
  type OptionsLectureDbf,
  type PortLecteurArchiveReprise,
  type ProfilColonne,
  type RapportTable,
  type ResultatDetectionFamilleReprise,
} from './port-lecteur-archive-reprise';

const LIMITE_ECHANTILLON_DEFAUT = 500;
const MAX_ENTREES_CACHE_ECHANTILLONS = 500;
const TAILLE_SONDE_FAMILLE_OCTETS = 8192;

/**
 * 80 Go — MESURÉ, pas deviné. Les deux archives réelles analysées par l'audit sécurité pèsent
 * 2,3 Go et 43,5 Go COMPRESSÉES (`TAILLE_MAX_ARCHIVE_REPRISE_OCTETS` = 60 Go, `contrats/
 * reprise.ts`, plafond déjà posé avec marge sur ce maximum). 80 Go de sortie DÉCOMPRESSÉE couvre
 * un ratio d'expansion jusqu'à ~1,8× le plus gros dépôt compressé AUTORISÉ — largement suffisant
 * pour du contenu Access/FoxPro (binaire, peu compressible, ratios réels mesurés très inférieurs
 * à 2×) — mais à des ordres de grandeur des ratios caractéristiques d'une bombe de décompression
 * (centaines à milliers de fois le poids compressé). Toute extraction qui franchit ce seuil est
 * donc, par construction, soit un bug soit une attaque — jamais un dépôt légitime.
 */
const LIMITE_OCTETS_EXTRAITS_TOTAL = 80_000_000_000;

/**
 * 200 000 entrées — aucune archive réelle mesurée n'approche quelques milliers de fichiers (une
 * base Access/FoxPro compte quelques dizaines à quelques centaines de fichiers/tables). Ce
 * plafond, large mais FINI, borne le travail syscall (mkdir/open/write) même si chaque entrée
 * pèse 0 octet — la variante de bombe qui vise le NOMBRE d'entrées plutôt que leur poids
 * individuel (que `LIMITE_OCTETS_EXTRAITS_TOTAL` seul ne bornerait pas).
 */
const LIMITE_ENTREES_ARCHIVE = 200_000;

/**
 * 3 h (RÉVISÉ le 26.08.2026, mesuré — voir plus bas ; 24 h jusque-là). Ces répertoires contiennent
 * des DONNÉES PERSONNELLES RÉELLES en clair (clients, immatriculations, parfois des dossiers de
 * solvabilité) — un résidu qui traîne 24 h après un plantage sans nécessité est un problème nLPD
 * réel, pas un détail de ménage disque (mesuré : deux répertoires `extrait-*` coexistaient,
 * l'un orphelin, après les plantages du jour). Deux bornes mesurées encadrent ce choix, aucune
 * devinée : la durée RÉELLE la plus longue observée sur l'archive complète de @laupernoe (552 tables,
 * 2,3 Go) le 26.08.2026 — 29 min 13 (import, pire cas, rejeu idempotent) — et le plafond ABSOLU
 * documenté d'un SEUL appel `mdb-export` (`DELAI_ABSOLU_EXPORT_MS`, `lecteurs/access/
 * lecteur-access.ts`) — 2 h, jamais mesuré en pratique mais la garde dure du dépôt contre un
 * export qui ne se termine jamais. 3 h dépasse le pire cas RÉEL d'un facteur ~6 et le plafond
 * ABSOLU documenté d'une marge d'1 h — un résidu de PLANTAGE (le seul cas que le nettoyage
 * immédiat des appelants ne peut pas couvrir — voir « PURGE DU RÉPERTOIRE D'EXTRACTION » en tête
 * de fichier) ne survit donc plus qu'à la prochaine activité de reprise dans les 3 h, de N'IMPORTE
 * QUEL tenant, jamais un résidu actif : aucun job mesuré ce jour, ni même le plafond absolu
 * documenté du dépôt, n'approche cette durée.
 */
const DUREE_MAX_RESIDU_EXTRACTION_MS = 3 * 60 * 60 * 1000;

/** Transforme le flux d'une entrée ZIP en comptant les octets réellement écrits sur disque dans
 *  `budget` (CUMULÉ sur TOUTE l'extraction, pas seulement l'entrée courante — une bombe peut
 *  aussi bien être UNE entrée énorme que des milliers de petites) ; interrompt le flux dès que
 *  `LIMITE_OCTETS_EXTRAITS_TOTAL` est franchi. `pipeline()` (node:stream/promises) détruit alors
 *  TOUS les flux de la chaîne (lecture zip + écriture disque) — jamais un flux abandonné à
 *  moitié ouvert. */
function creerLimiteurOctetsExtraits(
  budget: { octetsExtraits: number },
  limiteOctets: number,
): Transform {
  return new Transform({
    transform(morceau: Buffer, _encodage, rappel) {
      budget.octetsExtraits += morceau.length;
      if (budget.octetsExtraits > limiteOctets) {
        rappel(
          new ErreurLimiteExtractionDepassee(
            'octets_extraits',
            budget.octetsExtraits,
            limiteOctets,
          ),
        );
        return;
      }
      rappel(null, morceau);
    },
  });
}

function estSousRacine(racine: string, cheminAbs: string): boolean {
  const racineAbs = resolve(racine) + sep;
  return cheminAbs === resolve(racine) || (resolve(cheminAbs) + sep).startsWith(racineAbs);
}

/** Overrides de test pour les trois seuils de sécurité — voir le constructeur de
 *  `AdaptateurLecteurArchiveReprise`. */
export interface LimitesExtractionArchiveReprise {
  readonly octetsExtraitsMax?: number;
  readonly entreesMax?: number;
  readonly dureeMaxResiduMs?: number;
}

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
export class AdaptateurLecteurArchiveReprise implements PortLecteurArchiveReprise, OnModuleInit {
  private readonly racineTravail: string;
  private readonly cache = new CacheEchantillons();
  private readonly limiteOctetsExtraitsTotal: number;
  private readonly limiteEntreesArchive: number;
  private readonly dureeMaxResiduMs: number;

  /**
   * Second paramètre RÉSERVÉ AUX TESTS (`LimitesExtractionArchiveReprise`) — les seuils réels
   * (80 Go / 200 000 entrées / 3 h) ne sont JAMAIS testables tels quels sans construire une
   * archive de plusieurs dizaines de Go ou des centaines de milliers d'entrées. Défauts identiques
   * aux constantes de production — un appel `new AdaptateurLecteurArchiveReprise()` (le seul
   * utilisé par `reprise.module.ts`, DI réelle) se comporte exactement comme avant ce paramètre.
   */
  constructor(
    racineTravail: string = join(process.cwd(), 'uploads', 'reprise-extraction'),
    limites: LimitesExtractionArchiveReprise = {},
  ) {
    this.racineTravail = racineTravail;
    this.limiteOctetsExtraitsTotal = limites.octetsExtraitsMax ?? LIMITE_OCTETS_EXTRAITS_TOTAL;
    this.limiteEntreesArchive = limites.entreesMax ?? LIMITE_ENTREES_ARCHIVE;
    this.dureeMaxResiduMs = limites.dureeMaxResiduMs ?? DUREE_MAX_RESIDU_EXTRACTION_MS;
  }

  /**
   * Purge INCONDITIONNELLE, au démarrage du process (défaut réel du 25.08.2026 — voir « PURGE DU
   * RÉPERTOIRE D'EXTRACTION », mécanisme 3, en tête de fichier). Best-effort, jamais bloquant pour
   * le démarrage de l'API : une purge manquée ici est retentée par `purgerResidusAnciens` (3 h)
   * au prochain passage, jamais une raison d'empêcher l'API de démarrer.
   */
  async onModuleInit(): Promise<void> {
    await this.purgerResidusOrphelinsAuDemarrage().catch(() => undefined);
  }

  private async purgerResidusOrphelinsAuDemarrage(): Promise<void> {
    let entrees: Dirent[];
    try {
      entrees = await readdir(this.racineTravail, { withFileTypes: true });
    } catch {
      return; // racine pas encore créée — rien à purger
    }
    for (const entree of entrees) {
      if (!entree.isDirectory()) continue;
      await rm(join(this.racineTravail, entree.name), { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }

  // --- Décompression + inventaire ---------------------------------------------------------------

  async extraireEtInventorier(
    cheminArchive: string,
  ): Promise<{ readonly repertoire: string; readonly fichiers: readonly FichierArchiveSource[] }> {
    await this.purgerResidusAnciens();
    await mkdir(this.racineTravail, { recursive: true });
    const repertoire = await mkdtemp(join(this.racineTravail, 'extrait-'));
    try {
      const fichiers = await this.extraireZip(cheminArchive, repertoire);
      return { repertoire, fichiers };
    } catch (erreur) {
      // Nettoyage du résidu PARTIEL avant de propager — une extraction abandonnée (bombe de
      // décompression stoppée en cours de route, entrée fatale...) ne doit jamais laisser de
      // données personnelles en clair sur disque, même incomplètes.
      await rm(repertoire, { recursive: true, force: true }).catch(() => undefined);
      throw erreur;
    }
  }

  /** Nettoyage IMMÉDIAT après usage — appelé par les appelants dans un `finally`, succès ou échec.
   *  Voir « PURGE DU RÉPERTOIRE D'EXTRACTION » en tête de fichier pour la doctrine complète.
   *  Reprend la garde anti-évasion `estSousRacine` (même patron que `StockageArchiveRepriseDisque
   *  Local.purgerDossier`) : un chemin hors de `racineTravail` n'est JAMAIS supprimé, même si
   *  `repertoire` était corrompu. */
  async purgerRepertoireExtrait(repertoire: string): Promise<void> {
    const cheminAbsolu = resolve(repertoire);
    if (!estSousRacine(this.racineTravail, cheminAbsolu)) {
      throw new Error(
        `AdaptateurLecteurArchiveReprise.purgerRepertoireExtrait : chemin hors racine refusé (« ${repertoire} »).`,
      );
    }
    await rm(cheminAbsolu, { recursive: true, force: true });

    // Second point de balayage des résidus de PLANTAGE, EN PLUS de celui déjà posé en tête de
    // `extraireEtInventorier` — défaut réel du 26.08.2026 : le seul balayage au DÉMARRAGE d'une
    // extraction attend la PROCHAINE activité de reprise pour rattraper un résidu laissé par un
    // plantage antérieur ; sur un serveur qui tourne longtemps sans nouvelle reprise, ce résidu de
    // données personnelles patiente sans nécessité. Appelé ICI, à la FIN de CHAQUE job (succès ou
    // échec — ce point est dans le `finally` des deux appelants), la fenêtre entre « un résidu
    // apparaît » et « il est balayé » se referme dès le PROCHAIN job COMPLET, jamais seulement au
    // prochain DÉMARRAGE. Best-effort, même garantie que `purgerResidusAnciens` elle-même : un
    // échec de balayage ne doit jamais faire remonter d'erreur depuis LE NETTOYAGE DE CE job, qui
    // vient de réussir.
    await this.purgerResidusAnciens().catch(() => undefined);
  }

  /** Balayage des résidus de PLANTAGE — voir « PURGE DU RÉPERTOIRE D'EXTRACTION » en tête de
   *  fichier. Best-effort délibéré : un résidu manqué ici (permission, course avec une extraction
   *  concurrente légitime) est retenté au prochain passage, jamais une raison de faire échouer
   *  l'extraction EN COURS. */
  private async purgerResidusAnciens(): Promise<void> {
    let entrees: Dirent[];
    try {
      entrees = await readdir(this.racineTravail, { withFileTypes: true });
    } catch {
      return; // racine pas encore créée (premier passage) — rien à purger
    }
    const seuilMs = Date.now() - this.dureeMaxResiduMs;
    for (const entree of entrees) {
      if (!entree.isDirectory()) continue;
      const chemin = join(this.racineTravail, entree.name);
      try {
        const infos = await stat(chemin);
        if (infos.mtimeMs < seuilMs) {
          await rm(chemin, { recursive: true, force: true });
        }
      } catch {
        // best-effort — voir la doc de la méthode
      }
    }
  }

  private async extraireZip(
    cheminArchive: string,
    repertoireDestination: string,
  ): Promise<FichierArchiveSource[]> {
    const fichiers: FichierArchiveSource[] = [];
    const budget = { octetsExtraits: 0, entrees: 0 };
    const zipfile = await openPromise(cheminArchive, { lazyEntries: true, autoClose: true });
    try {
      for await (const entree of zipfile.eachEntry()) {
        budget.entrees += 1;
        if (budget.entrees > this.limiteEntreesArchive) {
          throw new ErreurLimiteExtractionDepassee(
            'nombre_entrees',
            budget.entrees,
            this.limiteEntreesArchive,
          );
        }

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
        fichiers.push(await this.ecrireEntreeZip(zipfile, entree, cheminDestination, budget));
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
    budget: { octetsExtraits: number },
  ): Promise<FichierArchiveSource> {
    try {
      const flux = await zipfile.openReadStreamPromise(entree);
      const hash = createHash('sha256');
      let taille = 0;
      flux.on('data', (morceau: Buffer) => {
        hash.update(morceau);
        taille += morceau.length;
      });
      const limiteur = creerLimiteurOctetsExtraits(budget, this.limiteOctetsExtraitsTotal);
      await pipeline(flux, limiteur, createWriteStream(cheminDestination));
      return {
        chemin: cheminDestination,
        tailleOctets: taille,
        lisible: true,
        empreinteSha256: hash.digest('hex'),
      };
    } catch (erreur) {
      // Dépassement de budget : FATAL pour toute l'extraction, jamais absorbé comme une simple
      // entrée illisible — propagé tel quel pour que `extraireZip`/`extraireEtInventorier`
      // abandonnent et nettoient.
      if (erreur instanceof ErreurLimiteExtractionDepassee) throw erreur;
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

  /**
   * ANOMALIE MESURÉE le 26.08.2026 (`RepAw.backup`, archive réelle Auto-i de @laupernoe) : la branche
   * 'access' filtrait ICI sur l'EXTENSION du fichier (`/\.(mdb|accdb)$/i`) avant même de sonder son
   * contenu — alors que `lecteurs/detection-famille.ts` documente EXPLICITEMENT, dans son propre
   * en-tête, que ce chantier a choisi de reconnaître la famille « toujours sur le contenu binaire,
   * jamais sur l'extension du fichier », en citant CE MÊME fichier comme cas ayant guidé ce choix
   * (« un fichier nommé `RepAw.backup` était une base Access parfaitement valide »). Cette branche
   * violait sa propre doctrine documentée un étage plus bas : un fichier Access réel sans extension
   * `.mdb`/`.accdb` rendait `[]` SANS jamais appeler `mdb-tables`, donc SANS lever d'erreur ni
   * remonter d'anomalie — `service-analyse-reprise.executer` classait alors ce fichier `ignore`
   * (jamais `fichier_illisible`), et si c'était le SEUL fichier de l'archive, `tables.length === 0`
   * faisait échouer l'analyse ENTIÈRE (`echecTotal`), sans aucun indice sur la cause réelle.
   *
   * PREUVE que ceci n'a jamais été détecté sur l'archive complète (781 entrées) : `RepAw.backup` y
   * était SILENCIEUSEMENT ignoré exactement de la même façon (même code, même garde) — mais
   * plusieurs AUTRES fichiers de cette archive (`AutoI/Backups/Anwender20100107.mdb`,
   * `Anwender20100408.mdb`, `Anwender_corrompu.mdb`) portent, eux, l'extension `.mdb` ET contiennent
   * chacun une table `Kunden` (mesuré : `mdb-tables -1` en direct sur ces trois fichiers). Le succès
   * antérieur rapporté sur l'archive complète (« Kunden » trouvée) venait de l'un de CES fichiers,
   * jamais de `RepAw.backup` — l'échec de ce dernier était simplement invisible au milieu de
   * centaines d'autres tables trouvées ailleurs, jamais reproduit isolément avant que ce fichier ne
   * soit seul dans l'archive.
   *
   * CORRECTIF : sonder le CONTENU (`detecterFamilleFichier`, même sonde 8 Ko que
   * `detecterFamilleRepertoire`) au lieu de l'extension — aligné sur la doctrine déjà posée par
   * `lecteurs/detection-famille.ts`. Un fichier sans signature Jet/ACE valide (`.exe`, `.dll`, note
   * texte, `.mdb` réellement vide/corrompu) continue de rendre `[]` sans appeler `mdb-tables` —
   * comportement inchangé pour ce cas ; seul le fichier `.backup`/`.bak`/sans extension qui EST une
   * vraie base Access cesse désormais d'être ignoré à tort.
   */
  async listerTables(
    cheminFichier: string,
    famille: FamilleMoteurSourceReprise,
  ): Promise<readonly string[]> {
    const familleLecteurs = versLecteurs(famille);
    if (familleLecteurs === 'access') {
      if ((await this.detecterFamilleFichier(cheminFichier)) !== 'access') return [];
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

  /**
   * O(n) sur la table entière (voir « COMPTAGE ACCESS » en tête de fichier) — donc le SEUL point
   * de ce module capable, à lui seul, de tenir le fil plusieurs secondes/minutes d'affilée sur une
   * table de plusieurs millions de lignes (mesuré : `lireLignesAccess` restitue chaque ligne via
   * un flux dont le tampon est souvent déjà rempli, donc un `for await` nu résout ses itérations
   * en microtâches — voir `common/concurrence/ceder-controle-event-loop.ts` pour la mesure). Cède
   * la main régulièrement PENDANT ce comptage, indépendamment de la cession déjà posée par
   * l'appelant entre deux tables (`analyse/service-analyse-reprise.ts`) : celle-ci ne peut agir
   * qu'ENTRE deux `await`, jamais À L'INTÉRIEUR d'un seul appel `compterLignes` déjà en cours sur
   * UNE table volumineuse.
   */
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
      const cedeurEventLoop = creerCedeurEventLoop();
      let n = 0;
      for await (const _ligne of lireLignesAccess(cheminFichier, table)) {
        n++;
        await cedeurEventLoop.cederSiNecessaire();
      }
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
