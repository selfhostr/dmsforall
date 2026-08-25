/**
 * Port de lecture de l'archive source — interface stable côté MODULE REPRISE, codée contre le
 * vocabulaire déjà posé par `apps/api/src/reprise/lecteurs/types.ts` (bibliothèque pure, sans
 * dépendance Nest) pour tout ce qui reste INTERNE au traitement (colonnes, lignes, évaluation de
 * rôle), MAIS PAS pour la famille de moteur : voir `ResultatDetectionFamilleReprise` ci-dessous.
 *
 * FRONTIÈRE DE TYPES (point de friction réglé ici, signalé par les deux agents précédents) : la
 * famille de moteur est la SEULE information de ce port qui remonte, telle quelle, jusqu'à une
 * réponse d'API (`ReponseAnalyseReprise.moteurDetecte.famille`, `contrats/reprise.ts`). Avant ce
 * correctif, le port exposait le type INTERNE `lecteurs/types.ts::FamilleMoteur` ('access' |
 * 'foxpro-dbase' | 'inconnu') sur `detecterFamille()` ET sur chaque méthode qui en dépend
 * (`listerTables`, `evaluerRole`, `profilerColonnes`, `detecterLiens`, `compterLignes`) —
 * `analyse/service-analyse-reprise.ts` devait alors connaître le vocabulaire interne de
 * `lecteurs/` et une fonction de projection séparée (`projeterFamilleMoteur`,
 * `analyse/projection-analyse-reprise.ts`) convertissait après coup vers le contrat. Désormais,
 * ce port parle EXCLUSIVEMENT `FamilleMoteurSourceReprise` (`@dfa/shared`, le contrat gelé) sur
 * toute sa surface publique : la bibliothèque garde ses types internes, le contrat partagé reste
 * la frontière publique, et c'est l'ADAPTATEUR (`adaptateur-lecteur-archive-reprise.ts`), pas le
 * module appelant, qui convertit dans les deux sens — c'est sa raison d'être.
 *
 * Un adaptateur FACTICE (`lecture/adaptateur-lecteur-archive-reprise-factice.ts`) implémente ce
 * port pour les tests — jamais de dépendance directe à `lecteurs/` dans les tests de ce module.
 */

import type { FamilleMoteurSourceReprise } from '@dfa/shared';
import type {
  EnTeteDbf,
  EvaluationRole,
  LienCandidat,
  LigneTable,
  OptionsLectureDbf,
  ProfilColonne,
  RapportTable,
} from '../lecteurs/types';

export type {
  EnTeteDbf,
  EvaluationRole,
  LienCandidat,
  LigneTable,
  OptionsLectureDbf,
  ProfilColonne,
  RapportTable,
};

/** Résultat de reconnaissance de famille, côté PORT (contrat public) — miroir de
 *  `lecteurs/types.ts::ResultatDetectionFamille`, `famille` déjà converti vers le contrat. */
export interface ResultatDetectionFamilleReprise {
  readonly famille: FamilleMoteurSourceReprise;
  readonly fichiersPertinents: readonly string[];
  readonly raison: string;
}

/** Un fichier trouvé dans l'archive décompressée, AVANT toute classification de rôle — miroir
 *  minimal de `FichierArchiveReprise` (contrats/reprise.ts), côté lecture pure. */
export interface FichierArchiveSource {
  readonly chemin: string;
  readonly tailleOctets: number;
  readonly lisible: boolean;
  readonly empreinteSha256: string | null;
}

/**
 * Bombe de décompression (finding sécurité HAUTE) OU trop d'entrées dans l'archive — abandon
 * explicite par `extraireEtInventorier`, jamais un crash silencieux ou un remplissage de disque
 * non borné. Définie ICI (le PORT), pas dans l'adaptateur concret : les appelants
 * (`analyse/service-analyse-reprise.ts`) doivent pouvoir la distinguer d'une corruption
 * générique SANS dépendre du type interne de l'adaptateur — même doctrine que le reste de ce
 * fichier (codé contre le port, jamais contre l'implémentation).
 */
export class ErreurLimiteExtractionDepassee extends Error {
  constructor(
    readonly type: 'octets_extraits' | 'nombre_entrees',
    readonly mesure: number,
    readonly limite: number,
  ) {
    super(
      `limite d'extraction dépassée (${type} : ${mesure} > ${limite}) — archive abandonnée, résidu nettoyé`,
    );
    this.name = 'ErreurLimiteExtractionDepassee';
  }
}

export interface PortLecteurArchiveReprise {
  /**
   * Décompresse l'archive déposée (voir `depot/stockage-archive-reprise.ts` pour le chemin
   * assemblé) dans un répertoire de travail, et rend son chemin PLUS l'inventaire À PLAT des
   * fichiers trouvés — AVANT reconnaissance de famille (celle-ci porte sur le contenu de ces
   * fichiers, via `cheminRepertoireExtrait` rendu ici).
   */
  extraireEtInventorier(cheminArchive: string): Promise<{
    readonly repertoire: string;
    readonly fichiers: readonly FichierArchiveSource[];
  }>;

  /**
   * Nettoyage IMMÉDIAT du répertoire rendu par `extraireEtInventorier` — à appeler par TOUT
   * appelant dans un `finally`, que le traitement de l'archive réussisse ou échoue (finding
   * sécurité nLPD : des données personnelles en clair ne doivent JAMAIS survivre au traitement
   * qui les a extraites). Idempotente : ne lève pas si le répertoire est déjà absent.
   */
  purgerRepertoireExtrait(repertoire: string): Promise<void>;

  /** Reconnaissance de la famille de moteur sur les fichiers extraits (en-tête binaire). */
  detecterFamille(cheminRepertoireExtrait: string): Promise<ResultatDetectionFamilleReprise>;

  /**
   * Parmi plusieurs fichiers CANDIDATS pour la même table logique (copies rivales — sauvegardes,
   * exports successifs du même DMS trouvés côte à côte dans l'archive), rend celui qui fait foi.
   * `null` si aucun signal ne permet de trancher (les candidats sont conservés comme fichiers
   * distincts, jamais fusionnés à l'aveugle).
   */
  choisirCopieFaisantFoi(candidats: readonly string[]): Promise<string | null>;

  /** Liste les tables lisibles d'un fichier reconnu (ex. les `.dbf` d'un répertoire FoxPro, ou
   *  les tables d'un `.mdb`/`.accdb` Access). */
  listerTables(
    cheminFichier: string,
    famille: FamilleMoteurSourceReprise,
  ): Promise<readonly string[]>;

  /** Verdict de classification de rôle métier (§ tête de fichier lecteurs/types.ts) — jamais
   *  déduit du seul nom de la table. */
  evaluerRole(
    cheminFichier: string,
    famille: FamilleMoteurSourceReprise,
    table: string,
  ): Promise<RapportTable>;

  /** Profil colonne par colonne (remplissage, format de date détecté, dates aberrantes) — même
   *  granularité que `ConstatQualiteTableReprise` (contrats/reprise.ts). */
  profilerColonnes(
    cheminFichier: string,
    famille: FamilleMoteurSourceReprise,
    table: string,
  ): Promise<readonly ProfilColonne[]>;

  /** Correspondances candidates entre une table et une autre (clé étrangère probable) — sert à
   *  rattacher un index de documents scannés à ses documents (D-32). */
  detecterLiens(
    cheminFichier: string,
    famille: FamilleMoteurSourceReprise,
    table: string,
  ): Promise<readonly LienCandidat[]>;

  /**
   * Lecture EN FLUX PARESSEUX, table par table — jamais le fichier entier en mémoire (archives
   * mesurées jusqu'à 43 Go, 9,4 millions de lignes sur un seul référentiel). `options.limite`
   * permet un échantillonnage (analyse) ; l'import consomme le flux SANS limite.
   */
  lireLignes(
    cheminFichier: string,
    famille: FamilleMoteurSourceReprise,
    table: string,
    options?: OptionsLectureDbf,
  ): AsyncIterable<LigneTable>;

  /** Nombre total de lignes actives (hors marquées supprimées) — pour le volume attendu du plan
   *  et la barre de progression de l'import, sans lire le contenu. */
  compterLignes(
    cheminFichier: string,
    famille: FamilleMoteurSourceReprise,
    table: string,
  ): Promise<number>;
}
