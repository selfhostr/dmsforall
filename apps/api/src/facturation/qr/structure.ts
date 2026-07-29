/**
 * Structure du Swiss QR Code (« Swiss Payments Code ») — la seule source de vérité du dépôt
 * pour l'ORDRE et le NOMBRE des éléments de la charge utile.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────
 * TRANCHÉ : le décompte est de 31 éléments jusqu'au trailer `EPD` inclus.
 * ────────────────────────────────────────────────────────────────────────────────────────
 *
 * `docs/modele-documentaire-facturation.md` §5.3 décrit le bloc *Ultimate Creditor* comme
 * « 6 lignes vides ». **C'est faux, et le §5.3 de `docs/specification-etape-2-facturation.md`
 * a raison de le contester** : un bloc d'adresse du Swiss QR Code comporte `AdrTp` **plus**
 * ses six lignes (nom, rue/ligne 1, n°/ligne 2, NPA, localité, pays), soit **7 champs**. Le
 * bloc *Ultimate Creditor*, réservé et jamais rempli, est donc émis comme **7 champs vides**,
 * exactement comme un bloc débiteur omis.
 *
 * Niveau de preuve — à lire avant de faire confiance à ce fichier :
 *
 *  - ❌ Le PDF officiel *Swiss Implementation Guidelines QR-bill* (SIX) n'a **pas** pu être lu
 *    directement : l'extraction de texte du PDF a rendu du contenu manifestement faux
 *    (« UltmtCdtr : 8 éléments », « Version = 00020 », un champ `DtInf/DueDate` inexistant en
 *    v2.0). Aucune de ces valeurs n'a été retenue. **Le décompte ci-dessous n'a donc PAS été
 *    lu dans le document officiel.**
 *  - ✅ Il est confirmé par trois sources indépendantes et concordantes :
 *      1. `stapelberg/qrbill` (Go) — émet 7 champs pour `UltmtCdtr`, `EPD` en 31e position ;
 *      2. `claudep/swiss-qr-bill` (Python) — littéralement `[''] * 7` pour l'Ultimate Creditor ;
 *      3. la documentation `docs.qr-invoice.ch`, qui publie une charge utile d'exemple
 *         complète de **34 lignes** = 31 (jusqu'à `EPD`) + 1 (Swico) + 2 (AltPmt).
 *
 *  ⚠️  Si un jour ce décompte doit changer, **tout se corrige ici** : les constantes nommées
 *      ci-dessous et `ORDRE_CHAMPS_PAYLOAD`. Aucun autre fichier ne compte de champs à la
 *      main, et `structure.spec.ts` échoue si les deux cessent de concorder.
 *
 * Versions de la spécification (état au 29.07.2026) : IG 2.3 en vigueur depuis le 22.11.2025
 * (adresse combinée `K` supprimée — seule l'adresse structurée `S` subsiste) ; IG 2.4 publiée
 * le 24.02.2026, applicable au 14.11.2026, **sans changement technique pour les QR-factures en
 * CHF** (elle restreint les combinaisons IBAN/référence en EUR). Le champ `Version` de la
 * charge utile vaut `0200` — c'est la version de la *structure de données* du Swiss QR Code,
 * qui n'a pas suivi la numérotation des Implementation Guidelines.
 */

/** `QRCH/Hdr/QRType` — invariant. */
export const QR_TYPE = 'SPC';

/**
 * `QRCH/Hdr/Version` — version de la structure de données du Swiss QR Code, pas celle des
 * Implementation Guidelines. Inchangée de l'IG 2.0 à l'IG 2.4.
 */
export const VERSION_STRUCTURE_QR = '0200';

/** `QRCH/Hdr/Coding` — `1` = jeu de caractères UTF-8 restreint. Seule valeur admise. */
export const TYPE_ENCODAGE_UTF8 = '1';

/** `QRCH/RmtInf/AddInf/Trailer` — marqueur de fin des données de paiement. */
export const TRAILER_EPD = 'EPD';

/** Séparateur d'éléments : CR+LF. Un `\n` seul produit une charge utile refusée. */
export const SEPARATEUR_LIGNE_PAYLOAD = '\r\n';

/**
 * Seul type d'adresse encore admis depuis l'IG 2.3 (22.11.2025). L'adresse combinée `K` a été
 * supprimée de la spécification : ne jamais la réintroduire.
 */
export const TYPE_ADRESSE_STRUCTUREE = 'S';

/* ────────────────────────────────────────────────────────────────────────────────────────
 * Les décomptes, nommés et documentés (cf. `CF-21`)
 * ──────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Nombre de champs d'un bloc d'adresse : `AdrTp`, `Name`, `StrtNmOrAdrLine1`,
 * `BldgNbOrAdrLine2`, `PstCd`, `TwnNm`, `Ctry`.
 *
 * **C'est LE chiffre contesté par le modèle documentaire (qui dit 6).** Il vaut 7 : le type
 * d'adresse est un champ à part entière, pas un préfixe de la ligne « nom ».
 */
export const NOMBRE_CHAMPS_BLOC_ADRESSE = 7;

/**
 * Décompte de référence, écrit à la main (et non dérivé de `ORDRE_CHAMPS_PAYLOAD`, exprès :
 * deux affirmations indépendantes qui doivent concorder valent mieux qu'une tautologie).
 *
 * ```
 *   en-tête        SPC / 0200 / 1                                     3   →  3
 *   IBAN           QRCH/CdtrInf/IBAN                                  1   →  4
 *   créancier      AdrTp + 6 lignes                                   7   → 11
 *   Ultm. Creditor 7 champs VIDES (réservé, jamais rempli)            7   → 18
 *   montant/devise Amt + Ccy                                          2   → 20
 *   débiteur       AdrTp + 6 lignes, ou 7 champs vides si omis        7   → 27
 *   référence      Tp + Ref                                           2   → 29
 *   message        Ustrd                                              1   → 30
 *   trailer        EPD                                                1   → 31
 * ```
 */
export const NOMBRE_ELEMENTS_JUSQU_A_EPD = 31;

/** 31 + `StrdBkgInf` (information de facturation Swico S1). */
export const NOMBRE_ELEMENTS_AVEC_INFO_FACTURATION = 32;

/**
 * 32 + une seule `AltPmt`.
 *
 * ⚠️  **Ce cas manque à la spécification interne.** `docs/specification-etape-2-facturation.md`
 * §5.3 et `CF-21` énumèrent « 31, 32 ou 34 » et sautent 33. Or les procédures alternatives sont
 * indépendantes l'une de l'autre : n'en déclarer qu'une donne 33 éléments, et c'est parfaitement
 * conforme. Un garde-fou qui n'admettrait que 31/32/34 refuserait donc d'émettre une facture
 * valide — l'énumération de la spécification est un sous-ensemble, pas la règle.
 */
export const NOMBRE_ELEMENTS_AVEC_UNE_PROCEDURE_ALTERNATIVE = 33;

/** 32 + les deux `AltPmt` (procédures alternatives). Maximum absolu de la structure. */
export const NOMBRE_ELEMENTS_AVEC_PROCEDURES_ALTERNATIVES = 34;

/**
 * Tous les décomptes admissibles. Toute autre valeur signale un champ en trop ou en moins,
 * donc un décalage de toute la fin de la charge utile.
 */
export const DECOMPTES_ELEMENTS_ADMIS: readonly number[] = [
  NOMBRE_ELEMENTS_JUSQU_A_EPD,
  NOMBRE_ELEMENTS_AVEC_INFO_FACTURATION,
  NOMBRE_ELEMENTS_AVEC_UNE_PROCEDURE_ALTERNATIVE,
  NOMBRE_ELEMENTS_AVEC_PROCEDURES_ALTERNATIVES,
];

/** Nombre maximal de procédures alternatives (`QRCH/AltPmt`). */
export const NOMBRE_MAX_PROCEDURES_ALTERNATIVES = 2;

/**
 * Longueur maximale de la charge utile, séparateurs compris. Au-delà, le symbole QR ne tient
 * plus dans le module de 46 × 46 mm imposé à la zone de paiement.
 */
export const LONGUEUR_MAX_PAYLOAD = 997;

/**
 * Ordre exact des champs, du premier au dernier. Deuxième affirmation indépendante du
 * décompte : `structure.spec.ts` vérifie que `EPD` y occupe bien la 31e position et que la
 * liste compte 34 entrées.
 */
export const ORDRE_CHAMPS_PAYLOAD = [
  'QRCH/Hdr/QRType',
  'QRCH/Hdr/Version',
  'QRCH/Hdr/Coding',
  'QRCH/CdtrInf/IBAN',
  'QRCH/CdtrInf/Cdtr/AdrTp',
  'QRCH/CdtrInf/Cdtr/Name',
  'QRCH/CdtrInf/Cdtr/StrtNmOrAdrLine1',
  'QRCH/CdtrInf/Cdtr/BldgNbOrAdrLine2',
  'QRCH/CdtrInf/Cdtr/PstCd',
  'QRCH/CdtrInf/Cdtr/TwnNm',
  'QRCH/CdtrInf/Cdtr/Ctry',
  'QRCH/UltmtCdtr/AdrTp',
  'QRCH/UltmtCdtr/Name',
  'QRCH/UltmtCdtr/StrtNmOrAdrLine1',
  'QRCH/UltmtCdtr/BldgNbOrAdrLine2',
  'QRCH/UltmtCdtr/PstCd',
  'QRCH/UltmtCdtr/TwnNm',
  'QRCH/UltmtCdtr/Ctry',
  'QRCH/CcyAmt/Amt',
  'QRCH/CcyAmt/Ccy',
  'QRCH/UltmtDbtr/AdrTp',
  'QRCH/UltmtDbtr/Name',
  'QRCH/UltmtDbtr/StrtNmOrAdrLine1',
  'QRCH/UltmtDbtr/BldgNbOrAdrLine2',
  'QRCH/UltmtDbtr/PstCd',
  'QRCH/UltmtDbtr/TwnNm',
  'QRCH/UltmtDbtr/Ctry',
  'QRCH/RmtInf/Tp',
  'QRCH/RmtInf/Ref',
  'QRCH/RmtInf/AddInf/Ustrd',
  'QRCH/RmtInf/AddInf/Trailer',
  'QRCH/RmtInf/AddInf/StrdBkgInf',
  'QRCH/AltPmt[1]',
  'QRCH/AltPmt[2]',
] as const;

/* ────────────────────────────────────────────────────────────────────────────────────────
 * Longueurs maximales par champ (Swiss Implementation Guidelines QR-bill)
 * ──────────────────────────────────────────────────────────────────────────────────────── */

export const LONGUEURS_MAX = {
  iban: 21,
  nom: 70,
  rue: 70,
  numero: 16,
  npa: 16,
  localite: 35,
  pays: 2,
  montant: 12,
  referenceQrr: 27,
  referenceScor: 25,
  messageNonStructure: 140,
  informationFacturation: 140,
  procedureAlternative: 100,
  /**
   * `Ustrd` + `StrdBkgInf` réunis ne peuvent pas dépasser 140 caractères — contrainte
   * conjointe, en plus des 140 de chacun pris isolément.
   */
  messageEtInformationFacturation: 140,
} as const;

/** `QRCH/RmtInf/Tp` — le type de référence découle de l'IBAN, il n'est jamais un choix (`RF-55`). */
export const TYPES_REFERENCE = ['QRR', 'SCOR', 'NON'] as const;
export type TypeReference = (typeof TYPES_REFERENCE)[number];

/** Devises admises par la spécification. Toute autre devise interdit la section paiement QR. */
export const DEVISES_ADMISES = ['CHF', 'EUR'] as const;
export type DeviseQr = (typeof DEVISES_ADMISES)[number];

/** Montant minimal encodable : 0.01. Un montant à 0 est encodé comme « pas de montant ». */
export const MONTANT_MIN_CENTIMES = 1;

/** Montant maximal encodable : 999'999'999.99. */
export const MONTANT_MAX_CENTIMES = 99_999_999_999;
