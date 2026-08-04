/**
 * Enums de la facturation (étape 2) — chaîne devis → bon de commande → facture → avoir.
 *
 * Références : `docs/specification-etape-2-facturation.md` (`RF-xx`, `CF-xx`) et
 * `docs/modele-documentaire-facturation.md` (`MD-xx`, `PF-xx`, `QF-xx`). Chaque constante cite sa
 * règle d'origine — un futur écart entre le contrat et la spec doit pouvoir se retrouver en une
 * recherche.
 *
 * Domaine SÉPARÉ de `contrats/atelier` : la facturation ne réexporte ni ne redéfinit les enums de
 * l'OR (`TypeLigneOr`, `PayeurLigneOr`…). Un document facturé RECOPIE des valeurs figées au sens de
 * `MD-24` ; il ne les référence jamais dynamiquement, et son propre contrat n'a donc pas à dépendre
 * du module qui les a produites.
 */

/* ------------------------------------------------------------------ */
/* Chaîne documentaire (MD-11 → MD-23, RF-1 → RF-19)                   */
/* ------------------------------------------------------------------ */

/**
 * `type_document` — **GELÉ** (`x-dfa-enum-extensible: false`). Quatre séries de numérotation
 * indépendantes (`MD-11`). Le vocabulaire d'affichage correspondant est figé par `RF-3`
 * (clés i18n `facturation.document.type.*`).
 */
export const TYPES_DOCUMENT_VENTE = ['devis', 'bon_commande', 'facture', 'avoir'] as const;
export type TypeDocumentVente = (typeof TYPES_DOCUMENT_VENTE)[number];

/**
 * `nature_facture` — **GELÉ**. Une facture d'acompte n'est PAS un cinquième type de document
 * (`MD-12`) : c'est une `facture` de nature `acompte`, dans la même série continue que les
 * factures ordinaires. `null` pour les trois autres types de document.
 */
export const NATURES_FACTURE = ['ordinaire', 'acompte'] as const;
export type NatureFacture = (typeof NATURES_FACTURE)[number];

/**
 * `origine_document` — **GELÉ** (`MD-01`). Un document est produit par DFA, ou il a été importé
 * depuis le système précédent — il n'existe pas de troisième cas. `origine` est immuable dès
 * l'insertion (`MD-02`), y compris sur un brouillon.
 */
export const ORIGINES_DOCUMENT = ['dfa', 'reprise'] as const;
export type OrigineDocument = (typeof ORIGINES_DOCUMENT)[number];

/**
 * `statut_document` — **GELÉ**, union des états atteignables par au moins un des quatre types de
 * document (§1.2 du modèle documentaire) :
 *
 * | Type | États |
 * |---|---|
 * | `devis` | `brouillon` → `emis` → {`accepte`, `refuse`, `expire`, `remplace`} |
 * | `bon_commande` | `brouillon` → `emis` → {`transforme`, `annule`} |
 * | `facture` | `brouillon` → `emis` → `annule_par_avoir` |
 * | `avoir` | `brouillon` → `emis` |
 * | tous | `brouillon` → `abandonne` |
 *
 * **Les transitions vivent dans une table côté serveur (`transition_document_autorisee`,
 * `MD-17`), pas dans le type TypeScript** — exactement le patron déjà retenu pour
 * `STATUTS_ORDRE_REPARATION` / la table `transition_autorisee` de l'étape 1. Un client ne doit
 * donc jamais déduire « quels statuts sont valides pour quel type de document » de cet enum seul :
 * c'est `actionsDisponibles` sur la ressource qui fait foi (même principe que
 * `ActionOrdreReparation`).
 */
export const STATUTS_DOCUMENT_VENTE = [
  'brouillon',
  'emis',
  'accepte',
  'refuse',
  'expire',
  'remplace',
  'transforme',
  'annule',
  'annule_par_avoir',
  'abandonne',
] as const;
export type StatutDocumentVente = (typeof STATUTS_DOCUMENT_VENTE)[number];

/**
 * `statut_reglement` — **GELÉ**, colonne DÉRIVÉE maintenue par trigger depuis
 * `imputation_paiement` (`MD-16`, `RF-68`).
 *
 * DÉCISION DE CONCEPTION, à mettre en regard de `StatutOrdreReparation` /
 * `EtatAfficheOrdreReparation` de l'étape 1 (deux types distincts, sans alias de confort, parce
 * que les drapeaux `attentes` de l'OR sont TROIS booléens indépendants qui peuvent être vrais
 * simultanément et doivent être réduits à UNE seule pastille par une règle de priorité calculée
 * une fois côté serveur).
 *
 * La facturation NE reproduit PAS ce patron, et ce n'est pas un oubli :
 *
 * 1. `RF-68` l'interdit explicitement — « le règlement n'est pas un état du document » — pour une
 *    raison de machine à états, pas d'affichage : mélanger les deux ferait ressembler « payer » à
 *    « modifier », et le trigger d'immuabilité (`MD-20`) devrait faire des exceptions.
 * 2. `statut` et `statutReglement` ne sont JAMAIS en concurrence pour le même espace d'affichage.
 *    L'OR avait besoin d'UNE pastille (`BadgeStatutOr`) parce que trois attentes indépendantes
 *    peuvent survenir en même temps et il faut choisir laquelle montrer en premier. Une facture
 *    n'a qu'un `statut` (un seul actif à la fois, terminal une fois émis dans les faits) et qu'un
 *    `statutReglement` (cinq valeurs MUTUELLEMENT EXCLUSIVES, jamais deux vraies à la fois) : il
 *    n'y a rien à arbitrer par priorité, donc rien à fusionner. Un écran de liste affiche les deux
 *    côte à côte (« Émise · Partiellement réglée ») sans perte d'information.
 *
 * Conclusion : PAS de troisième type « `EtatAfficheDocumentVente` ». `statut` et
 * `statutReglement` restent deux colonnes lues indépendamment ; `RF-83` (facturation et
 * restitution indépendantes) est le même principe appliqué à la relation OR ↔ facture.
 */
export const STATUTS_REGLEMENT_DOCUMENT = [
  'non_regle',
  'partiel',
  'regle',
  'trop_percu',
  'irrecouvrable',
] as const;
export type StatutReglementDocument = (typeof STATUTS_REGLEMENT_DOCUMENT)[number];

/** `portee_avoir` — **GELÉ** (`MD-23`). Un avoir corrige tout ou partie des lignes de la facture. */
export const PORTEES_AVOIR = ['total', 'partiel'] as const;
export type PorteeAvoir = (typeof PORTEES_AVOIR)[number];

/**
 * `motif_avoir` — **GELÉ** (`RF-15`), liste courte imposée. `autre` exige un texte libre
 * (`motifAutre`), contrôlé par `.refine()` sur `schemaCreationAvoir` — voir `document.ts`. Le
 * motif part dans le journal d'audit et sur le PDF de l'avoir (`RF-15`) : une fiduciaire qui voit
 * trois avoirs le même jour doit trouver la réponse dans le document, pas dans la mémoire du
 * réceptionnaire.
 */
export const MOTIFS_AVOIR = [
  'erreur_adresse',
  'erreur_montant',
  'erreur_destinataire',
  'erreur_taux',
  'prestation_annulee',
  'geste_commercial',
  'autre',
] as const;
export type MotifAvoir = (typeof MOTIFS_AVOIR)[number];

/* ------------------------------------------------------------------ */
/* Montants, TVA (MD-35 → MD-49, RF-33 → RF-52)                        */
/* ------------------------------------------------------------------ */

/**
 * `regime_tva` — extensible (§11.2 du contrat étape 1 : un régime inconnu doit être rendu
 * génériquement, jamais faire échouer un client). `exonere` et `exclu` valent tous deux `0 ‰`
 * mais se déclarent différemment (`MD-37`) ; `marge` ne concerne que les documents repris
 * antérieurs au 01.01.2018 (`MD-68`, abrogation de l'imposition de la marge).
 */
export const REGIMES_TVA = [
  'normal',
  'reduit',
  'hebergement',
  'exonere',
  'exclu',
  'marge',
  'acquisition',
] as const;
export type RegimeTva = (typeof REGIMES_TVA)[number];

/**
 * `mode_calcul_tva` — **GELÉ** (`MD-43`). Champ de LECTURE SEULE sur une ligne de document : il
 * n'existe dans AUCUN schéma d'entrée de la facturation.
 *
 * Décision de @laupernoe, non rouverte : le prix saisi dans la facturation est TOUJOURS un TTC en
 * centimes entiers (y compris pour les entreprises) ; HT et TVA en sont dérivés côté serveur,
 * jamais saisis. `RF-40` proposait des défauts `ht`/`ttc` par type de ligne — cette proposition
 * était explicitement marquée « à valider avec @laupernoe » (hypothèse #2 de `§11.1`) et @laupernoe l'a
 * tranchée en faveur du tout-TTC pour toute saisie directe en facturation.
 *
 * Le champ reste néanmoins nécessaire EN LECTURE : une ligne recopiée depuis un OR (`RF-81`,
 * `MD-24`) porte le mode que l'atelier a utilisé pour son propre calcul (`ht` par défaut pour la
 * main-d'œuvre côté atelier, `AC-05`), et un document repris (`origine = 'reprise'`) porte le mode
 * de sa source. Le document affiché doit donc pouvoir distinguer les deux, même si aucune saisie
 * facturation ne produit plus jamais de ligne en mode `ht`.
 */
export const MODES_CALCUL_TVA = ['ht', 'ttc'] as const;
export type ModeCalculTva = (typeof MODES_CALCUL_TVA)[number];

/** Devise d'un document ou d'un paiement — `MD-58`/`RF-58` : CHF ou EUR uniquement pour porter une
 *  section QR ; une facture dans une autre devise existe mais perd sa section paiement. */
export const DEVISES_FACTURATION = ['CHF', 'EUR'] as const;
export type DeviseFacturation = (typeof DEVISES_FACTURATION)[number];

/* ------------------------------------------------------------------ */
/* Lignes de document (§3, §7 de la spécification métier)              */
/* ------------------------------------------------------------------ */

/**
 * `type_ligne_document` — extensible (§11.2). Reprend le vocabulaire des types de ligne d'OR pour
 * les lignes recopiées (`main_oeuvre_bareme`, `main_oeuvre_temps_reel`, `forfait`, `piece`,
 * `fourniture`, `sous_traitance`, `produit_atelier`, `taxe`, `texte`) et ajoute les types propres
 * à la facturation :
 *
 * - `acompte_deduit` — ligne négative, déduction d'un acompte facturé (`MD-55`) ;
 * - `ecart_reprise` — écart entre la somme des lignes et le total stocké d'un document repris
 *   (`MD-08`), jamais sur un document `origine = 'dfa'` ;
 * - `repartition` — franchise ou prise en charge partielle par un tiers, en miroir signé sur les
 *   deux documents (`MD-63`, `RF-96`) ;
 * - `consigne` — consigne d'échange standard, facturée à l'aller et remboursable par avoir partiel
 *   au retour de la pièce (`RF-100`). Voir l'hypothèse ouverte n° 4 de `§11.1` : la pratique elle-
 *   même n'est pas confirmée, mais le type de ligne est posé pour ne pas coûter de migration s'il
 *   est activé plus tard.
 *
 * **`remise` est délibérément ABSENT** (`RF-45`) : une remise de pied de facture est TOUJOURS
 * ventilée sur les lignes existantes (`RF-42` → `RF-44`), jamais portée par une ligne autonome —
 * une ligne de remise imputerait la remise sur un taux de TVA arbitraire.
 */
export const TYPES_LIGNE_DOCUMENT_VENTE = [
  'main_oeuvre_bareme',
  'main_oeuvre_temps_reel',
  'forfait',
  'piece',
  'fourniture',
  'sous_traitance',
  'produit_atelier',
  'taxe',
  'texte',
  'acompte_deduit',
  'ecart_reprise',
  'repartition',
  'consigne',
] as const;
export type TypeLigneDocumentVente = (typeof TYPES_LIGNE_DOCUMENT_VENTE)[number];

/* ------------------------------------------------------------------ */
/* Paiements et lettrage (MD-50 → MD-57, RF-65 → RF-80)                */
/* ------------------------------------------------------------------ */

/** `moyen_paiement` — extensible (§11.2 : un moyen inconnu — un futur prestataire suisse — doit
 *  être rendu génériquement par un client tiers). */
export const MOYENS_PAIEMENT = [
  'especes',
  'carte',
  'virement',
  'qr',
  'twint',
  'compensation',
  'leasing',
] as const;
export type MoyenPaiement = (typeof MOYENS_PAIEMENT)[number];

/**
 * `nature_imputation` — **GELÉ** (`MD-50`). `reglement` est la seule nature comptée dans
 * l'invariant `MD-51` (b) — `arrondi`, `escompte`, `perte` et `compensation` soldent un document
 * sans qu'aucun argent supplémentaire ne circule (`CF-05`, `CF-22`).
 */
export const NATURES_IMPUTATION = [
  'reglement',
  'escompte',
  'arrondi',
  'perte',
  'compensation',
] as const;
export type NatureImputation = (typeof NATURES_IMPUTATION)[number];

/** `paiement_source` — **GELÉ** (`MD-50`). `manuel` est la seule source produite par l'API de
 *  saisie directe ; `camt054` et `terminal` sont réservées à l'ingestion automatisée (phase 2). */
export const SOURCES_PAIEMENT = ['manuel', 'camt054', 'terminal'] as const;
export type SourcePaiement = (typeof SOURCES_PAIEMENT)[number];

/** Issue d'une avance client (trop-perçu) non imputée — `RF-79`, `MD-57`. Les trois issues sont
 *  TOUTES explicites, aucune automatique. Ce n'est pas un statut stocké : c'est la forme des
 *  actions possibles sur `GET /paiements/{id}` (`actionsDisponibles`). */
export const ISSUES_AVANCE_CLIENT = ['remboursement', 'imputation_future', 'abandon'] as const;
export type IssueAvanceClient = (typeof ISSUES_AVANCE_CLIENT)[number];

/* ------------------------------------------------------------------ */
/* Export fiduciaire (MD-84 → MD-93, RF-101 → RF-113)                  */
/* ------------------------------------------------------------------ */

/**
 * `cible_export` — extensible. Cibles retenues pour le pilote : **WinBIZ** (prioritaire).
 * `csv` reste la sortie générique de secours (`RF-101`). Les autres cibles (`bexio`, `abacus`,
 * `banana`) sont **différées** : elles ne sont pas abandonnées, seulement derrière WinBIZ pour
 * le premier garage, mais restent dans l'enum pour les futurs clients. `ireach` a été retiré du
 * contrat : il s'agit d'un DMS automobile concurrent (sujet de reprise de données, non une cible
 * d'export).
 *
 * L'enum PostgreSQL `cible_export` en migration 0010 contient déjà toutes ces valeurs — ce
 * contrat TypeScript doit rester aligné avec la base.
 */
export const CIBLES_EXPORT = ['bexio', 'winbiz', 'abacus', 'banana', 'csv'] as const;
export type CibleExport = (typeof CIBLES_EXPORT)[number];

/**
 * `mode_granularite_export` — paramétrable par tenant ET par cible (`PF-05`, `MD-88`, `RF-106`).
 * `detaille` : une écriture par document puis par paiement. `agrege` : une écriture par
 * jour × compte × taux de TVA. Trois choses ne sont JAMAIS agrégées quel que soit le mode
 * (`RF-107`) : les taux de TVA entre eux, le compte de créances clients par client, les exercices
 * entre eux — ce n'est pas exprimable dans cet enum, c'est une contrainte d'implémentation.
 */
export const MODES_GRANULARITE_EXPORT = ['detaille', 'agrege'] as const;
export type ModeGranulariteExport = (typeof MODES_GRANULARITE_EXPORT)[number];
