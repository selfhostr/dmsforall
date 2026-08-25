import { z } from 'zod';

import { schemaIdentifiant, schemaMotif } from './atelier/primitives';
import type { OrigineDocument } from './facturation/enums';
import { schemaListeQuery } from './filtres';
import { schemaParametresPage, type PageCurseur } from './pagination';

/**
 * Reprise de données par dépôt d'archive — le garagiste dépose l'archive de son ancien DMS, le
 * système identifie SEUL le moteur, trouve SEUL les tables métier, propose un plan, et importe
 * après UNE SEULE validation humaine. Le client ne répond à aucune question technique.
 *
 * CE QUE DEUX ARCHIVES RÉELLES (Microsoft Access, Visual FoxPro) ONT ÉTABLI, ET QUI CONTRAINT CE
 * CONTRAT DANS SA FORME :
 *   - **Un nom ne prouve rien.** Un fichier portant le nom du produit peut être un catalogue de
 *     référence tiers sans aucune donnée du garage ; une table portant le nom officiel du fichier
 *     clients peut être vide, la vraie donnée étant ailleurs. Toute table détectée porte donc un
 *     rôle métier DÉDUIT, un indice de confiance, et la raison de la déduction — jamais une
 *     certitude (`TableDetecteeReprise`).
 *   - **Le périmètre varie radicalement d'un garage à l'autre.** Aucun domaine n'est requis :
 *     l'absence totale d'historique atelier ou de facturation est un cas NORMAL, pas une erreur.
 *   - **Les formats piègent** : dates en texte `aaaa.mm.jj`, dates aberrantes par erreur de siècle,
 *     TVA tantôt par ligne tantôt globale au document tantôt absente, encodages hérités. Remontés
 *     au client dans son vocabulaire via des CODES (`ConstatQualiteTableReprise`), jamais une
 *     chaîne technique en dur.
 *   - **Les volumes sont réels** : jusqu'à 43 Go d'archive, 9,4 millions de lignes sur une seule
 *     table de référentiel. Tout est ASYNCHRONE — dépôt par tranches, analyse et import en tâche de
 *     fond ; rien ne se fait dans le temps d'une requête HTTP.
 *
 * PÉRIMÈTRE DE REPRISE ARBITRÉ (décisions D-29→D-34 du wiki, non rediscutées ici) : détail ligne à
 * ligne sur 24 mois glissants PLUS tout ce qui est ouvert sans limite de date ; en-têtes de
 * document + totaux + ventilation TVA sur 10 ans ; documents scannés SEULEMENT s'ils sont
 * rattachables par un index source ; comptabilité NON reprise sauf les soldes ouverts ;
 * référentiels constructeur JAMAIS repris. Voir `PerimetreReprise`/`MotifExclusionPlanReprise`.
 *
 * QUATRE ÉTAPES, UNE RESSOURCE RACINE (`DossierReprise`) QUI LES TRAVERSE TOUTES :
 *   1. Dépôt de l'archive (tranches, reprise après interruption, finalisation + intégrité).
 *   2. Analyse automatique (moteur, inventaire, tables + rôle déduit, constats, anomalies).
 *   3. Plan de reprise proposé (ce qui est importé / écarté avec motif, ajustements limités).
 *   4. Import et rapport (avancement, puis rapport avec réconciliation chiffrée).
 *
 * DOCTRINE TRANSVERSALE DE CE FICHIER, NON NÉGOCIABLE :
 *   - Tenant résolu depuis la session : AUCUN `tenantId` dans un corps ou une URL.
 *   - Zéro chaîne destinée à l'affichage : tout libellé visible du garagiste est une clé i18n
 *     (portée par un CODE énuméré ci-dessous) que le front traduit ; les `donnees`/`parametres`
 *     libres sont des sacs STRUCTURÉS (mêmes noms de champ que `ElementBloquant.donnees`,
 *     `probleme.ts`), jamais un texte à afficher tel quel.
 *   - Montants en CENTIMES entiers, jamais un flottant. Dates en `timestamptz` ISO 8601 UTC.
 *   - Idempotence sur toute création sensible (`Idempotency-Key`, doctrine `RC-06` appliquée par
 *     analogie) ; pagination par curseur sur toute collection ; erreurs en `problem+json`.
 *
 * CODES D'ERREUR SUGGÉRÉS — HORS PÉRIMÈTRE DE CE FICHIER (`contrats/probleme.ts::CODES_ERREUR` est
 * un registre central partagé ; l'y toucher pendant que trois autres agents travaillent en
 * parallèle serait une collision. À ajouter par un agent habilité, une fois ce contrat fusionné) :
 *   - `REPRISE_DOSSIER_TRANSITION_INTERDITE` (409) — même patron que `OR_TRANSITION_INTERDITE`.
 *   - `REPRISE_ARCHIVE_INCOMPLETE` (409) — `finaliser` appelé avant réception de tous les octets.
 *   - `REPRISE_EMPREINTE_INVALIDE` (409) — l'empreinte assemblée par le serveur ne correspond pas
 *     à celle annoncée à la création du dossier.
 *   - `REPRISE_TRANCHE_HORS_SEQUENCE` (400) — numéro de tranche hors des bornes déclarées.
 *   - `REPRISE_PLAN_NON_VALIDABLE` (409) — validation tentée hors de l'état `plan_propose`.
 *   - `REPRISE_AJUSTEMENT_ELEMENT_INCONNU` (400) — `elementId` d'un ajustement absent du plan
 *     courant (`schemaModificationPlanReprise`).
 *
 * CONSÉQUENCE HORS PÉRIMÈTRE SIGNALÉE, PAS TRAITÉE ICI : une fois un import réalisé, les
 * ressources de LECTURE de `atelier/client.ts`, `atelier/vehicule.ts`, `ventes/*`,
 * `facturation/document.ts`, `pieces/article.ts`, `pieces/fournisseur.ts`, `facturation/
 * paiement.ts` devront exposer `origine`/`numeroOrigine` (voir `AncrageOrigineReprise` ci-dessous,
 * qui n'est que le miroir de lecture — la colonne d'écriture vit dans ces migrations,
 * pas dans ce fichier) pour qu'un front affiche « importé depuis Auto-i, réf. 00214 ». Cette
 * extension de contrat n'est PAS faite ici : ce n'est pas mon périmètre d'écriture.
 */

/* ================================================================================================
 * Ancrage d'origine — miroir de lecture des colonnes `origine`/`numero_origine` (migrations 0010,
 * 0011, 0066 : `document_vente`, `ordre_reparation`, `client`, `vehicule`, `article`,
 * `fournisseur`, `paiement`). Même enum PARTAGÉ `ORIGINES_DOCUMENT` (`contrats/facturation/
 * enums.ts`, `public.origine_document`) — RÉUTILISÉ tel quel, jamais redéfini ici : un deuxième
 * enum à deux valeurs identiques (`dfa`/`reprise`) serait exactement la divergence que 0066
 * documente avoir voulu éviter côté base.
 * ============================================================================================ */

/** Même sémantique partout en base : `numeroOrigine` = chaîne source VERBATIM, jamais retouchée,
 *  `null` pour un enregistrement `origine = 'dfa'`. C'est CETTE PAIRE que le worker d'import écrit
 *  sur `client`/`vehicule`/`ordre_reparation`/`document_vente`/`article`/`fournisseur`/`paiement`
 *  pour garantir qu'un import rejoué (`POST .../import/rejouer`) ne crée jamais de doublon : la
 *  contrainte d'unicité `(tenant_id, numero_origine)` de chaque table fait le reste. */
export interface AncrageOrigineReprise {
  readonly origine: OrigineDocument;
  readonly numeroOrigine: string | null;
}

/* ================================================================================================
 * Constantes de transport
 * ============================================================================================ */

/** 60 Go — plafond avec marge sur le maximum mesuré (43 Go, archive Visual FoxPro réelle). */
export const TAILLE_MAX_ARCHIVE_REPRISE_OCTETS = 60_000_000_000;

/** Taille de tranche PAR DÉFAUT côté client tant que `ReponseCreationDossierReprise.
 *  tailleTrancheRecommandeeOctets` n'a pas encore été lue (première tranche du tout premier
 *  dépôt). Le serveur reste libre d'en recommander une autre par dossier — ce n'est qu'un défaut
 *  raisonnable, jamais une limite imposée à `PUT .../tranches/{numero}`. */
export const TAILLE_TRANCHE_RECOMMANDEE_OCTETS_DEFAUT = 16 * 1024 * 1024;

/** Empreinte SHA-256 hexadécimale — même forme que `connecteurs/primitives.ts::
 *  schemaEmpreinteSha256` (`RC-64`), redéfinie ICI plutôt qu'importée : ce fichier connecteurs
 *  n'exporte pas ses primitives via son barrel (délibérément « non réexportées », voir son
 *  en-tête), et dupliquer une regex à deux lignes coûte moins qu'un couplage entre deux domaines
 *  écrits en parallèle par des agents différents. */
export const schemaEmpreinteSha256Reprise = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[0-9a-f]{64}$/);

/** Numéro de tranche, 0-indexé. Borne haute très large (500 000 tranches) — jamais un objectif,
 *  juste un filet contre une boucle client pathologique. */
export const schemaNumeroTranche = z.coerce.number().int().min(0).max(500_000);

/* ================================================================================================
 * Cycle de vie du dossier — machine à états GELÉE, une ligne par tentative de reprise.
 * ============================================================================================ */

/**
 * `statut_dossier_reprise` — **GELÉ**. Transitions valides :
 *
 * ```
 * depot_en_cours    -> depot_receptionne   (finaliser, empreinte vérifiée)
 * depot_en_cours    -> annule
 * depot_receptionne -> analyse_en_cours    (automatique)
 * analyse_en_cours  -> analyse_terminee | analyse_echouee
 * analyse_echouee   -> analyse_en_cours    (relance SANS nouveau dépôt)
 * analyse_echouee   -> annule
 * analyse_terminee  -> plan_propose        (automatique, le système génère le plan)
 * plan_propose      -> plan_valide         (LA validation humaine unique)
 * plan_valide       -> import_en_cours     (même geste que la validation, aucun clic de plus)
 * plan_propose      -> annule
 * import_en_cours   -> import_termine | import_echoue
 * import_echoue     -> import_en_cours     (rejouer — idempotent via AncrageOrigineReprise,
 *                                            aucun doublon)
 * import_echoue     -> annule
 * * (tout état non terminal) -> annule     (geste volontaire, motif requis)
 * ```
 *
 * `plan_valide` est un état de transit délibérément COURT (l'import démarre dans la même
 * transaction logique que la validation) mais reste EXPOSÉ : c'est lui qui porte
 * `ReponsePlanReprise.valideLe`/`valideParUtilisateurId`, la preuve d'audit du geste.
 */
export const STATUTS_DOSSIER_REPRISE = [
  'depot_en_cours',
  'depot_receptionne',
  'analyse_en_cours',
  'analyse_echouee',
  'analyse_terminee',
  'plan_propose',
  'plan_valide',
  'import_en_cours',
  'import_termine',
  'import_echoue',
  'annule',
] as const;
export type StatutDossierReprise = (typeof STATUTS_DOSSIER_REPRISE)[number];

/** États TERMINAUX : aucune transition n'en part (même doctrine que `cycle-vie-tenant/enums.ts`). */
export const STATUTS_DOSSIER_REPRISE_TERMINAUX: readonly StatutDossierReprise[] = [
  'import_termine',
  'annule',
];

/* ================================================================================================
 * Étape 1 — Dépôt de l'archive
 * ============================================================================================ */

/**
 * `POST /reprise/dossiers` — crée le dossier ET déclare l'archive à venir. `Idempotency-Key`
 * OBLIGATOIRE (création sensible). Ne contient AUCUN octet : le transport binaire se fait ensuite
 * par tranches (`PUT .../tranches/{numero}`), jamais en une seule requête (archives de plusieurs
 * Go, un envoi monolithique est exclu).
 */
export const schemaCreationDossierReprise = z
  .object({
    tailleOctetsAnnoncee: z.number().int().min(1).max(TAILLE_MAX_ARCHIVE_REPRISE_OCTETS),
    empreinteSha256Annoncee: schemaEmpreinteSha256Reprise,
    /** Facultatif, pour le journal uniquement — jamais utilisé pour décider quoi que ce soit côté
     *  serveur (même doctrine que `connecteurs/import.ts::EntreeLancerImportConnecteur.
     *  nomFichierOriginal`). */
    nomArchiveOriginal: z.string().trim().max(255).optional(),
  })
  .strict();
export type EntreeCreationDossierReprise = z.infer<typeof schemaCreationDossierReprise>;

/** État de réception de l'archive — nested dans `ReponseDossierReprise.archive`, et corps intégral
 *  de `GET /reprise/dossiers/{id}/tranches` (reprise après interruption : le client demande cet
 *  état, reprend l'envoi à `dernierNumeroTrancheRecuContigu + 1`). */
export interface ArchiveDeposeeReprise {
  readonly tailleOctetsAnnoncee: number;
  readonly octetsRecus: number;
  /** Plus grand N tel que TOUTES les tranches `0..N` ont été reçues sans trou. `null` = aucune
   *  tranche reçue. Suffit à reprendre un envoi SÉQUENTIEL (le cas normal) sans faire porter à ce
   *  contrat la liste complète des tranches reçues — potentiellement des milliers sur une archive
   *  de 43 Go, un tableau qui n'apporterait rien à un client qui uploade dans l'ordre. */
  readonly dernierNumeroTrancheRecuContigu: number | null;
  readonly empreinteSha256Annoncee: string;
  /** Calculée par le SERVEUR après assemblage complet, à la finalisation. `null` tant que
   *  `finaliser` n'a pas encore été appelé avec succès. */
  readonly empreinteSha256Verifiee: string | null;
  /** `null` tant que non finalisé. Sinon : `empreinteSha256Verifiee === empreinteSha256Annoncee`.
   *  `false` = archive corrompue en transit, le dossier NE PASSE PAS `depot_receptionne`. */
  readonly integriteValidee: boolean | null;
}

export interface ReponseCreationDossierReprise {
  readonly dossier: ReponseDossierReprise;
  /** Taille de tranche recommandée PAR CE DOSSIER — le client peut s'en écarter, le serveur
   *  accepte toute taille de tranche raisonnable (`PUT .../tranches/{numero}` reste sans corps
   *  zod-validé, voir plus bas), c'est un confort pour dimensionner une barre de progression. */
  readonly tailleTrancheRecommandeeOctets: number;
}

/**
 * `PUT /reprise/dossiers/{id}/tranches/{numero}` — dépose une tranche binaire de l'archive.
 * Requête : `application/octet-stream`, corps = les octets bruts de la tranche. PAS DE SCHÉMA ZOD
 * DE CORPS ICI — même doctrine que `vehicules/scan-permis-circulation.ts` : un upload binaire
 * n'est pas un objet JSON validable comme le reste de l'API. `{numero}` validé par
 * `schemaNumeroTranche`.
 *
 * IDEMPOTENT PAR CONSTRUCTION, pas d'`Idempotency-Key` : redéposer le MÊME numéro de tranche
 * (reprise après coupure réseau en plein milieu d'une tranche) écrase la précédente sans effet de
 * bord — c'est précisément le mécanisme de reprise après interruption demandé.
 */
export interface ReponseTrancheDeposee {
  readonly numero: number;
  /** Cumul de tous les octets reçus pour ce dossier après cette tranche, tranches en doublon
   *  comprises une seule fois. */
  readonly octetsRecus: number;
  /** `true` si `octetsRecus === archive.tailleOctetsAnnoncee` — signale au client qu'il peut
   *  appeler `finaliser`, mais NE remplace PAS le contrôle d'intégrité qu'il effectue. */
  readonly toutesTranchesRecues: boolean;
}

/**
 * `POST /reprise/dossiers/{id}/finaliser` — assemble les tranches, calcule l'empreinte SHA-256
 * réelle, et la compare à `empreinteSha256Annoncee` (déclarée à `POST /reprise/dossiers`). Sur
 * succès : `depot_en_cours -> depot_receptionne`, l'analyse démarre automatiquement. Sur échec
 * d'intégrité : le dossier RESTE `depot_en_cours` (`409 REPRISE_EMPREINTE_INVALIDE`), le client
 * doit redéposer les tranches concernées — aucune tranche n'est effacée par un échec de
 * finalisation, un nouvel appel `finaliser` peut être retenté sans tout retélécharger.
 *
 * `empreinteSha256Calculee` : recalcul CÔTÉ CLIENT, signal de défense en profondeur (détecte une
 * corruption avant même que le serveur assemble 43 Go) — le serveur calcule la sienne
 * INDÉPENDAMMENT et c'est SA valeur qui fait foi pour `integriteValidee`, jamais celle du client.
 */
export const schemaFinalisationDepotReprise = z
  .object({
    empreinteSha256Calculee: schemaEmpreinteSha256Reprise,
  })
  .strict();
export type EntreeFinalisationDepotReprise = z.infer<typeof schemaFinalisationDepotReprise>;

/* ================================================================================================
 * Étape 2 — Analyse automatique
 * ============================================================================================ */

export const STATUTS_ANALYSE_REPRISE = ['en_cours', 'terminee', 'echouee'] as const;
export type StatutAnalyseReprise = (typeof STATUTS_ANALYSE_REPRISE)[number];

/**
 * `famille_moteur_source_reprise` — EXTENSIBLE. FAMILLE, jamais un nom commercial : un même
 * produit change de moteur selon la version installée, détecter le nom du produit ne dit rien de
 * fiable sur le format des fichiers à lire. `inconnu` est une VALEUR à part entière (moteur
 * cherché, non identifié), distincte d'une analyse qui n'a pas encore tourné.
 */
export const FAMILLES_MOTEUR_SOURCE_REPRISE = [
  'access_jet',
  'foxpro_dbf',
  'sql_server',
  'mysql',
  'sqlite',
  'fichier_plat_delimite',
  'inconnu',
] as const;
export type FamilleMoteurSourceReprise = (typeof FAMILLES_MOTEUR_SOURCE_REPRISE)[number];

export interface MoteurSourceDetecte {
  readonly famille: FamilleMoteurSourceReprise;
  /** 0-100. Un ORDRE DE GRANDEUR pour trier/filtrer un écran technique — jamais lu comme une
   *  probabilité statistique exacte. Même échelle que `TableDetecteeReprise.indiceConfiance`. */
  readonly indiceConfiance: number;
  /** Détails structurés (ex. extension de fichier reconnue, version de pilote détectée) — un sac,
   *  jamais un texte à afficher tel quel (doctrine de tête de fichier). */
  readonly donnees?: Readonly<Record<string, unknown>>;
}

/** `type_fichier_archive_reprise` — EXTENSIBLE. Classe CHAQUE fichier trouvé dans l'archive, y
 *  compris ceux qui ne deviendront jamais une table (`ignore`) — l'inventaire est complet, pas
 *  filtré a priori : un fichier ignoré aujourd'hui reste visible pour le support. */
export const TYPES_FICHIER_ARCHIVE_REPRISE = [
  'base_donnees',
  'export_tabulaire',
  'document_scanne',
  /** Table/fichier qui relie un scan à un document source (numéro de facture, date…) — la
   *  condition posée par D-32 pour qu'un document scanné soit repris. */
  'index_documents_scannes',
  'ignore',
  'inconnu',
] as const;
export type TypeFichierArchiveReprise = (typeof TYPES_FICHIER_ARCHIVE_REPRISE)[number];

export interface FichierArchiveReprise {
  /** Chemin RELATIF dans l'archive — opaque, jamais un chemin absolu du serveur. Sert de clé de
   *  corrélation avec les anomalies (`AnomalieAnalyseReprise.fichierChemin`). */
  readonly chemin: string;
  readonly tailleOctets: number;
  readonly type: TypeFichierArchiveReprise;
  /** `false` : fichier présent dans l'archive mais dont le contenu n'a pas pu être lu (corrompu,
   *  chiffré, format non supporté). Un fichier illisible n'invalide PAS les autres — voir
   *  `ReponseAnalyseReprise.partielle`. */
  readonly lisible: boolean;
  readonly empreinteSha256: string | null;
}

/**
 * `role_table_reprise` — EXTENSIBLE. Ce que l'analyse DÉDUIT du contenu d'une table, jamais de son
 * nom seul (« un nom ne prouve rien »). Couvre aussi les rôles qui ne seront JAMAIS importés
 * (`referentiel_constructeur`, `comptabilite_generale`) : les nommer permet au plan d'expliquer
 * une exclusion (`MotifExclusionPlanReprise`) au lieu de simplement faire disparaître la table.
 */
export const ROLES_TABLE_REPRISE = [
  'clients',
  'vehicules',
  'ordres_reparation',
  'lignes_ordre_reparation',
  'documents_vente',
  'lignes_document_vente',
  'paiements',
  'articles_stock',
  'mouvements_stock',
  'fournisseurs',
  /** D-34 : jamais repris, quelle que soit la confiance de détection. */
  'referentiel_constructeur',
  /** D-33 : non repris sauf soldes ouverts, traité via `paiements`/`documents_vente`, jamais par
   *  cette table elle-même. */
  'comptabilite_generale',
  'index_documents_scannes',
  /** Détectée, mais aucun rôle déduit avec une confiance suffisante — la table existe dans
   *  l'inventaire, le plan l'écarte avec le motif `role_indetermine`. */
  'inconnu',
] as const;
export type RoleTableReprise = (typeof ROLES_TABLE_REPRISE)[number];

/** `code_motif_deduction_role_table` — EXTENSIBLE. POURQUOI un rôle a été déduit — jamais un texte
 *  libre, toujours un code que le front traduit, assorti d'un sac `donnees` structuré (ex. les
 *  noms de colonnes qui ont matché). */
export const CODES_MOTIF_DEDUCTION_ROLE_TABLE = [
  'nom_table_correspondant',
  'colonnes_correspondantes',
  'volume_coherent_avec_role',
  'referentiel_connu_exclu',
  'estimation_faible_confiance',
  'index_croise_avec_autre_table',
] as const;
export type CodeMotifDeductionRoleTable = (typeof CODES_MOTIF_DEDUCTION_ROLE_TABLE)[number];

export interface MotifDeductionRoleTable {
  readonly code: CodeMotifDeductionRoleTable;
  readonly donnees?: Readonly<Record<string, unknown>>;
}

/** `gravite_constat_reprise` — partagée entre les constats de qualité et les anomalies
 *  (`ConstatQualiteTableReprise`, `AnomalieAnalyseReprise`, `AnomalieImportReprise`) : même échelle
 *  partout dans ce fichier, moins de surface à retenir pour les trois agents qui codent dessus. */
export const GRAVITES_CONSTAT_REPRISE = ['information', 'attention', 'bloquante'] as const;
export type GraviteConstatReprise = (typeof GRAVITES_CONSTAT_REPRISE)[number];

/** `type_constat_qualite_reprise` — EXTENSIBLE. Ce que l'analyse observe sur le CONTENU d'une
 *  table (remplissage, doublons, formats) — remonté au client dans son vocabulaire via le code,
 *  jamais une phrase technique en dur dans ce contrat. */
export const TYPES_CONSTAT_QUALITE_REPRISE = [
  'remplissage_faible',
  'doublons_probables',
  /** Ex. dates stockées `aaaa.mm.jj` plutôt que `jj.mm.aaaa` — `donnees.formatDetecte` porte le
   *  motif exact reconnu. */
  'format_date_ambigu',
  /** Ex. erreur de siècle (19xx lu comme 20xx ou l'inverse). */
  'dates_aberrantes',
  'tva_par_ligne',
  'tva_globale_document',
  'tva_absente',
  'encodage_heritage_detecte',
] as const;
export type TypeConstatQualiteReprise = (typeof TYPES_CONSTAT_QUALITE_REPRISE)[number];

export interface ConstatQualiteTableReprise {
  readonly type: TypeConstatQualiteReprise;
  /** Nom de colonne technique concerné, `null` si le constat porte sur la table entière. */
  readonly champ: string | null;
  readonly gravite: GraviteConstatReprise;
  readonly donnees?: Readonly<Record<string, unknown>>;
}

export interface PeriodeCouverteReprise {
  /** `aaaa-mm-jj`, toujours NORMALISÉE par le serveur — quel que soit le format source détecté
   *  (`format_date_ambigu`). `null` si aucune colonne de date fiable n'a été identifiée. */
  readonly debut: string | null;
  readonly fin: string | null;
}

export interface TableDetecteeReprise {
  /** Identifiant STABLE de cette détection au sein de l'analyse — référencé par
   *  `ElementPlanReprise.tableDetecteeId`/`ExclusionPlanReprise.tableDetecteeId`. Se régénère à
   *  chaque relance d'analyse (`POST .../analyses`) : un plan appartient à UNE analyse précise. */
  readonly id: string;
  readonly fichierChemin: string;
  /** Nom TECHNIQUE tel que lu dans le moteur source — détail d'audit, jamais montré au garagiste
   *  sur l'écran de validation (`ElementPlanReprise` porte le vocabulaire métier). */
  readonly nomTechnique: string;
  readonly roleDeduit: RoleTableReprise;
  readonly indiceConfiance: number;
  readonly motifsDeduction: readonly MotifDeductionRoleTable[];
  readonly nombreLignes: number;
  readonly periodeCouverte: PeriodeCouverteReprise | null;
  readonly constatsQualite: readonly ConstatQualiteTableReprise[];
}

/** `type_anomalie_analyse_reprise` — EXTENSIBLE. Ce qui empêche de LIRE un fichier ou une table,
 *  distinct d'un `ConstatQualiteTableReprise` (qui porte sur le CONTENU d'une table lisible). */
export const TYPES_ANOMALIE_ANALYSE_REPRISE = [
  'fichier_illisible',
  'encodage_indetermine',
  'moteur_non_reconnu',
  'archive_partiellement_corrompue',
  'mot_de_passe_requis',
  /** Une fois DÉCOMPRESSÉE, l'archive dépasse un volume ou un nombre de fichiers jugés
   *  raisonnables (garde-fou sécurité contre une bombe de décompression, finding audit
   *  25.08.2026) — DISTINCT de `archive_partiellement_corrompue` : le fichier déposé n'est pas
   *  forcément corrompu, il est simplement refusé tel quel. `donnees` porte `limiteType`
   *  (`'octets_extraits' | 'nombre_entrees'`), jamais un texte technique affiché tel quel. */
  'archive_volume_extrait_excessif',
] as const;
export type TypeAnomalieAnalyseReprise = (typeof TYPES_ANOMALIE_ANALYSE_REPRISE)[number];

export interface AnomalieAnalyseReprise {
  readonly type: TypeAnomalieAnalyseReprise;
  /** L'un des deux est renseigné selon que l'anomalie porte sur un fichier entier ou une table
   *  déjà identifiée dedans ; jamais les deux à la fois. */
  readonly fichierChemin: string | null;
  readonly tableDetecteeId: string | null;
  readonly gravite: GraviteConstatReprise;
  readonly donnees?: Readonly<Record<string, unknown>>;
}

/**
 * `GET /reprise/dossiers/{id}/analyse` — résultat COURANT de l'analyse. Ressource SINGLETON par
 * dossier (une analyse active à la fois ; une relance écrase la précédente plutôt que d'empiler un
 * historique — l'historique des tentatives passées n'a pas de valeur métier une fois qu'une
 * nouvelle analyse a tourné sur le même dépôt).
 *
 * `POST /reprise/dossiers/{id}/analyses` — lance ou relance l'analyse. Autorisé depuis
 * `depot_receptionne` ou `analyse_echouee` uniquement (`409
 * REPRISE_DOSSIER_TRANSITION_INTERDITE` sinon). Pas d'`Idempotency-Key` : transition gardée par
 * l'état de départ, même patron que `connecteurs/execution.ts::schemaRejouerExecutionConnecteur`.
 */
export interface ReponseAnalyseReprise {
  readonly id: string;
  readonly dossierRepriseId: string;
  readonly statut: StatutAnalyseReprise;
  /** `true` si au moins une anomalie de gravité `bloquante` a empêché la lecture d'UN fichier sans
   *  empêcher l'analyse des autres — « un fichier illisible n'invalide pas les autres ». `statut =
   *  'echouee'` (échec TOTAL, aucun fichier exploitable) et `partielle = true` (échec PARTIEL,
   *  résultat quand même utilisable) sont deux choses différentes, jamais confondues. */
  readonly partielle: boolean;
  readonly moteurDetecte: MoteurSourceDetecte;
  readonly fichiers: readonly FichierArchiveReprise[];
  readonly tables: readonly TableDetecteeReprise[];
  readonly anomalies: readonly AnomalieAnalyseReprise[];
  readonly demarreeLe: string | null;
  readonly termineeLe: string | null;
}

/* ================================================================================================
 * Étape 3 — Plan de reprise proposé
 * ============================================================================================ */

export const STATUTS_PLAN_REPRISE = ['propose', 'valide'] as const;
export type StatutPlanReprise = (typeof STATUTS_PLAN_REPRISE)[number];

/**
 * `perimetre_reprise` — GELÉ : reflète directement les décisions D-29→D-34, pas une classification
 * ouverte à extension libre — un cinquième régime ne peut naître que d'une nouvelle décision
 * métier, jamais d'un ajustement de contrat.
 */
export const PERIMETRES_REPRISE = [
  /** Détail ligne à ligne sur 24 mois glissants, PLUS tout ce qui est ouvert sans limite de
   *  date. */
  'detail_24_mois_glissants_et_ouverts',
  /** En-têtes de document + totaux + ventilation TVA, sur 10 ans. */
  'entetes_totaux_tva_10_ans',
  /** Comptabilité non reprise : SEULS les soldes ouverts le sont. */
  'soldes_ouverts_seuls',
  /** Documents scannés rattachés via un index source (D-32) — jamais sans cet index. */
  'documents_scannes_rattaches',
] as const;
export type PerimetreReprise = (typeof PERIMETRES_REPRISE)[number];

/** `domaine_reprise` — EXTENSIBLE. Le VOCABULAIRE MÉTIER de l'écran de validation — celui que voit
 *  un garagiste qui ne sait pas ce qu'est une table. Distinct de `RoleTableReprise` (vocabulaire
 *  TECHNIQUE de l'analyse) : plusieurs tables détectées peuvent alimenter un seul domaine (ex.
 *  `documents_vente` + `lignes_document_vente` -> domaine `documents_vente`). */
export const DOMAINES_REPRISE = [
  'clients',
  'vehicules',
  'ordres_reparation',
  'documents_vente',
  'paiements',
  'articles_stock',
  'fournisseurs',
  'documents_scannes',
] as const;
export type DomaineReprise = (typeof DOMAINES_REPRISE)[number];

export interface ElementPlanReprise {
  /** Identifiant STABLE de la ligne de plan — cible d'un ajustement
   *  (`schemaModificationPlanReprise`) et des compteurs du rapport final
   *  (`InsereParDomaineReprise.elementPlanId`). */
  readonly id: string;
  readonly domaine: DomaineReprise;
  /** Traçabilité vers l'analyse technique — le front n'a PAS à l'afficher sur l'écran de
   *  validation, seulement à s'en servir pour un lien « détails techniques » facultatif. */
  readonly tableDetecteeId: string;
  readonly perimetre: PerimetreReprise;
  readonly volumeAttenduLignes: number;
  /** `true` par défaut. Le SEUL levier que le client actionne (`schemaModificationPlanReprise`) —
   *  inclure/exclure ce domaine EN BLOC, jamais reconfigurer son périmètre ou son mapping :
   *  « un petit nombre d'ajustements possibles, pas un éditeur de mapping ». */
  readonly inclus: boolean;
  /** `false` pour un élément dont le périmètre est fixé par une décision D-29→D-34 sans variante
   *  possible (aujourd'hui : jamais — chaque domaine proposé reste basculable — mais le champ
   *  existe pour qu'un futur domaine obligatoire n'ait pas besoin d'un nouveau contrat). */
  readonly ajustable: boolean;
}

/** `code_motif_exclusion_plan_reprise` — EXTENSIBLE. */
export const MOTIFS_EXCLUSION_PLAN_REPRISE = [
  /** D-34. */
  'referentiel_constructeur_jamais_repris',
  /** D-33. */
  'comptabilite_non_reprise',
  'hors_perimetre_temporel',
  'role_indetermine',
  'table_vide',
  /** D-32 : scan sans index source pour le rattacher. */
  'document_non_rattachable',
  /** Deux tables détectées pour le même rôle — la moins probable est écartée plutôt qu'importée en
   *  double. */
  'doublon_table_meme_role',
  /** Ajustement explicite du client (`inclus: false`) — la seule entrée de cette liste qui ne
   *  vient PAS de l'analyse mais d'un geste humain. */
  'exclusion_manuelle',
] as const;
export type MotifExclusionPlanReprise = (typeof MOTIFS_EXCLUSION_PLAN_REPRISE)[number];

export interface ExclusionPlanReprise {
  readonly tableDetecteeId: string;
  readonly motif: MotifExclusionPlanReprise;
  readonly donnees?: Readonly<Record<string, unknown>>;
}

/**
 * `GET /reprise/dossiers/{id}/plan` — l'objet vu par le garagiste sur l'UNIQUE écran de
 * validation. Ressource SINGLETON par dossier, générée automatiquement à la fin d'une analyse
 * réussie (`analyse_terminee -> plan_propose`).
 */
export interface ReponsePlanReprise {
  readonly id: string;
  readonly dossierRepriseId: string;
  readonly analyseId: string;
  readonly statut: StatutPlanReprise;
  /** Ce qui SERA importé, un par domaine. */
  readonly elements: readonly ElementPlanReprise[];
  /** Ce qui est ÉCARTÉ, avec motif — jamais une table qui disparaît sans explication. */
  readonly exclusions: readonly ExclusionPlanReprise[];
  readonly proposeLe: string;
  readonly valideLe: string | null;
  readonly valideParUtilisateurId: string | null;
}

/**
 * `PATCH /reprise/dossiers/{id}/plan` — LE petit nombre d'ajustements possibles : inclure/exclure
 * des domaines EN BLOC. Refusé (`409 REPRISE_PLAN_NON_VALIDABLE`) hors de l'état `propose`
 * (immuable dès `plan_valide`, même doctrine que `DOCUMENT_VERROUILLE`). `elementId` inconnu du
 * plan courant -> `400 REPRISE_AJUSTEMENT_ELEMENT_INCONNU`, jamais ignoré en silence.
 */
export const schemaAjustementPlanReprise = z
  .object({
    elementId: schemaIdentifiant,
    inclus: z.boolean(),
  })
  .strict();
export type EntreeAjustementPlanReprise = z.infer<typeof schemaAjustementPlanReprise>;

export const schemaModificationPlanReprise = z
  .object({
    ajustements: z.array(schemaAjustementPlanReprise).min(1).max(50),
  })
  .strict();
export type EntreeModificationPlanReprise = z.infer<typeof schemaModificationPlanReprise>;

/**
 * `POST /reprise/dossiers/{id}/plan/valider` — LA validation humaine unique. Transitionne
 * `plan_propose -> plan_valide -> import_en_cours` dans le même geste (aucun second clic pour
 * lancer l'import). `Idempotency-Key` OBLIGATOIRE : c'est la création de l'exécution d'import,
 * une opération sensible qui écrit potentiellement des centaines de milliers de lignes — un rejeu
 * accidentel de cette requête précise ne doit jamais lancer un second import.
 */
export const schemaValidationPlanReprise = z.object({}).strict();
export type EntreeValidationPlanReprise = z.infer<typeof schemaValidationPlanReprise>;

/* ================================================================================================
 * Étape 4 — Import et rapport
 * ============================================================================================ */

export const STATUTS_IMPORT_REPRISE = [
  'en_attente',
  'en_cours',
  'termine',
  'echoue',
  'annule',
] as const;
export type StatutImportReprise = (typeof STATUTS_IMPORT_REPRISE)[number];

export interface ProgressionImportReprise {
  /** Compte d'ENREGISTREMENTS traités (tous domaines confondus), jamais un pourcentage flottant —
   *  le front calcule le ratio d'affichage lui-même s'il le souhaite. */
  readonly elementsTraites: number;
  readonly elementsTotal: number;
}

/**
 * `GET /reprise/dossiers/{id}/import` — suivi d'avancement. Ressource SINGLETON par dossier.
 *
 * `POST /reprise/dossiers/{id}/import/rejouer` — reprise après `import_echoue`, SANS créer de
 * doublon : le worker s'appuie sur `AncrageOrigineReprise` (contrainte d'unicité `(tenant_id,
 * numero_origine)` par table cible) pour sauter tout enregistrement déjà écrit lors d'une tentative
 * précédente. Pas d'`Idempotency-Key` : transition gardée par l'état de départ (`409
 * REPRISE_DOSSIER_TRANSITION_INTERDITE` hors de `import_echoue`).
 */
export interface ReponseImportReprise {
  readonly id: string;
  readonly dossierRepriseId: string;
  readonly planId: string;
  readonly statut: StatutImportReprise;
  /** Domaine EN COURS de traitement — `null` hors de `en_cours`. */
  readonly domaineCourant: DomaineReprise | null;
  readonly progression: ProgressionImportReprise;
  /** Commence à `1`, incrémenté à chaque `.../import/rejouer`. */
  readonly tentative: number;
  readonly demarreLe: string | null;
  readonly termineLe: string | null;
}

/** `code_motif_ecart_import_reprise` — EXTENSIBLE. Pourquoi une ligne SOURCE n'est pas devenue une
 *  ligne CIBLE au moment de l'import — distinct de `MotifExclusionPlanReprise`, qui joue au niveau
 *  d'une table entière AVANT même que l'import démarre. */
export const MOTIFS_ECART_IMPORT_REPRISE = [
  'ligne_invalide',
  'reference_manquante',
  'doublon_deja_importe',
  'hors_perimetre_temporel',
  'contrainte_metier_refusee',
] as const;
export type MotifEcartImportReprise = (typeof MOTIFS_ECART_IMPORT_REPRISE)[number];

export interface InsereParDomaineReprise {
  readonly domaine: DomaineReprise;
  readonly elementPlanId: string;
  readonly nombre: number;
}

export interface EcarteParDomaineReprise {
  readonly domaine: DomaineReprise;
  readonly elementPlanId: string;
  readonly motif: MotifEcartImportReprise;
  readonly nombre: number;
}

/** `type_anomalie_import_reprise` — EXTENSIBLE. Une ligne source individuelle qui a fait échouer sa
 *  propre écriture — bornée comme `connecteurs/execution.ts::ErreurExecutionConnecteur`, le compte
 *  réel vit dans `EcarteParDomaineReprise.nombre`, pas dans un tableau qui grossirait sans borne. */
export const TYPES_ANOMALIE_IMPORT_REPRISE = [
  'ligne_invalide',
  'reference_manquante',
  'doublon_deja_importe',
  'contrainte_metier_refusee',
] as const;
export type TypeAnomalieImportReprise = (typeof TYPES_ANOMALIE_IMPORT_REPRISE)[number];

export const SEUIL_ANOMALIES_EMBARQUEES_IMPORT_REPRISE = 50;

export interface AnomalieImportReprise {
  readonly type: TypeAnomalieImportReprise;
  readonly domaine: DomaineReprise;
  /** Numéro de ligne dans la table source, quand identifiable. */
  readonly ligneSource: number | null;
  readonly donnees?: Readonly<Record<string, unknown>>;
}

/**
 * Réconciliation chiffrée — LA preuve que rien ne s'est perdu. Une ligne par année couverte par
 * `documents_vente` (`PerimetreReprise` = `entetes_totaux_tva_10_ans` ou
 * `detail_24_mois_glissants_et_ouverts`). `ecartCentimes = totalCentimesCible -
 * totalCentimesSource` : `0` est la valeur attendue sur CHAQUE année, tout écart est le signal
 * d'un import incomplet, jamais absorbé silencieusement.
 */
export interface ReconciliationAnneeReprise {
  readonly annee: number;
  readonly nombreDocumentsSource: number;
  readonly nombreDocumentsCible: number;
  readonly totalCentimesSource: number;
  readonly totalCentimesCible: number;
  readonly ecartCentimes: number;
}

/**
 * `GET /reprise/dossiers/{id}/rapport` — dérivé des compteurs COURANTS de l'import : lisible dès
 * que l'import a démarré (`statut != 'en_attente'`), pas seulement une fois `termine`. Sur
 * `import_echoue`, montre ce qui a réellement été écrit avant l'échec — jamais masqué en attendant
 * une éventuelle reprise.
 */
export interface RapportImportReprise {
  readonly importId: string;
  readonly insere: readonly InsereParDomaineReprise[];
  readonly ecarte: readonly EcarteParDomaineReprise[];
  readonly anomalies: readonly AnomalieImportReprise[];
  readonly anomaliesTronquees: boolean;
  readonly reconciliation: readonly ReconciliationAnneeReprise[];
  readonly genereLe: string;
}

/* ================================================================================================
 * Ressource racine — collection des dossiers
 * ============================================================================================ */

export interface ReponseDossierReprise {
  readonly id: string;
  readonly statut: StatutDossierReprise;
  readonly archive: ArchiveDeposeeReprise;
  /** `null` tant que l'étape correspondante n'a jamais été atteinte — jamais un objet vide qui
   *  laisserait croire à une analyse/un plan/un import déjà commencé. */
  readonly analyseId: string | null;
  readonly planId: string | null;
  readonly importId: string | null;
  readonly creeLe: string;
  readonly modifieLe: string;
}

/** `GET /reprise/dossiers` — collection, curseur, tri par défaut `creeLe:desc`. Un tenant a
 *  normalement au plus un dossier actif à la fois, mais RIEN dans ce contrat ne l'impose (un
 *  dossier annulé peut être suivi d'un nouveau dépôt) — c'est une collection, pas un singleton. */
export const TRIS_DOSSIERS_REPRISE = ['creeLe:desc', 'creeLe:asc'] as const;
export const TRI_DEFAUT_DOSSIERS_REPRISE = 'creeLe:desc';

export const schemaFiltresDossiersReprise = schemaParametresPage.extend({
  statut: schemaListeQuery(z.enum(STATUTS_DOSSIER_REPRISE)).optional(),
  tri: z.enum(TRIS_DOSSIERS_REPRISE).default(TRI_DEFAUT_DOSSIERS_REPRISE),
});
export type FiltresDossiersReprise = z.infer<typeof schemaFiltresDossiersReprise>;

export type PageDossierReprise = PageCurseur<ReponseDossierReprise>;

/**
 * `POST /reprise/dossiers/{id}/annuler` — geste volontaire, motif requis (`RC-01` appliqué par
 * analogie : annuler ne doit jamais être bloqué techniquement, mais reste TRACÉ). Autorisé depuis
 * tout état NON terminal. `409 REPRISE_DOSSIER_TRANSITION_INTERDITE` depuis `import_termine` ou
 * `annule`.
 */
export const schemaAnnulationDossierReprise = z
  .object({
    motif: schemaMotif,
  })
  .strict();
export type EntreeAnnulationDossierReprise = z.infer<typeof schemaAnnulationDossierReprise>;

/**
 * `POST /reprise/dossiers/{id}/import/rejouer` — voir la documentation complète au-dessus de
 * `ReponseImportReprise`. Corps facultatif, même doctrine que `connecteurs/execution.ts::
 * schemaRejouerExecutionConnecteur` : un motif de contexte, jamais exigé.
 */
export const schemaRejouerImportReprise = z
  .object({
    motif: schemaMotif.optional(),
  })
  .strict();
export type EntreeRejouerImportReprise = z.infer<typeof schemaRejouerImportReprise>;
