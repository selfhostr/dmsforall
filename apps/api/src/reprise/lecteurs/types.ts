/**
 * Types internes à la bibliothèque de lecture des archives de reprise.
 *
 * Volontairement indépendants du contrat partagé `@dfa/shared` (en cours de figation par un
 * autre lot au moment de l'écriture) : la couche d'assemblage fera la conversion vers le
 * contrat public plus tard. Cette bibliothèque est pure — aucune dépendance à Nest.
 */

/** Famille de moteur de base de données reconnue à partir du contenu binaire des fichiers. */
export type FamilleMoteur = 'access' | 'foxpro-dbase' | 'inconnu';

/** Valeur décodée d'un champ, quel que soit le moteur d'origine. */
export type ValeurChamp = string | number | boolean | Date | null | Buffer;

/** Une ligne de table, quel que soit le moteur d'origine. */
export interface LigneTable {
  /** Index physique de l'enregistrement dans le fichier source (0-based). */
  index: number;
  valeurs: Record<string, ValeurChamp>;
}

/** Type de champ DBF/VFP tel que décrit dans le descripteur de champ (un caractère). */
export type TypeChampDbf = string;

export interface DescripteurChampDbf {
  nom: string;
  type: TypeChampDbf;
  longueur: number;
  decimales: number;
  /** Offset en octets du champ dans l'enregistrement (après l'octet de statut). */
  offset: number;
}

export interface EnTeteDbf {
  cheminDbf: string;
  /** Chemin du fichier mémo associé (.fpt), ou null si absent. */
  cheminMemo: string | null;
  octetVersion: number;
  nbEnregistrementsDeclares: number;
  tailleEntete: number;
  tailleEnregistrement: number;
  octetPageDeCode: number;
  /** Encodage retenu pour décoder les champs texte (cf. dbf/codepages.ts). */
  encodage: string;
  champs: DescripteurChampDbf[];
}

export interface OptionsLectureDbf {
  /** Force l'encodage plutôt que de le déduire de l'octet page de code de l'en-tête. */
  encodage?: string;
  /** Ne rend que les N premières lignes actives (échantillonnage). Sans limite : tout le fichier. */
  limite?: number;
}

/** Résultat de la reconnaissance de famille sur un répertoire décompressé. */
export interface ResultatDetectionFamille {
  famille: FamilleMoteur;
  /** Chemins relatifs des fichiers ayant servi de preuve (plafonné, pour rester lisible). */
  fichiersPertinents: string[];
  raison: string;
}

/** Rôle métier candidat pour une table, jamais déduit du seul nom. */
export type RoleMetier =
  | 'client'
  | 'vehicule'
  | 'document_vente'
  | 'ligne_document_vente'
  | 'ordre_reparation'
  | 'ligne_ordre_reparation'
  | 'article'
  | 'fournisseur'
  | 'paiement'
  | 'index_documentaire'
  | 'referentiel_constructeur'
  | 'inconnu';

export interface SignalColonne {
  colonne: string;
  motif: string;
  confiance: number;
  raison: string;
}

export interface EvaluationRole {
  role: RoleMetier;
  confiance: number;
  raison: string;
  signaux: SignalColonne[];
}

/** Verdict de classification d'une table : évaluations triées, la meilleure en tête. */
export interface RapportTable {
  table: string;
  lignesActives: number;
  lignesSupprimees: number;
  evaluations: EvaluationRole[];
}

export interface LienCandidat {
  tableSource: string;
  colonneSource: string;
  tableCible: string;
  colonneCible: string;
  /** Fraction des valeurs non nulles de la colonne source retrouvées dans la colonne cible. */
  tauxAppariement: number;
  raison: string;
}

export interface ProfilColonne {
  colonne: string;
  total: number;
  remplis: number;
  nulls: number;
  vides: number;
  espacesSeuls: number;
  tauxRemplissage: number;
  formatDateDetecte?: 'jj.mm.aaaa' | 'aaaa.mm.jj' | 'inconnu';
  datesAberrantes?: number;
}
