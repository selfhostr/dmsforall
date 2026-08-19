import type { OrigineDonneeFacture } from '@dfa/shared';

/**
 * Types de PORT de la chaîne de lecture (QR → texte du PDF → OCR en dernier recours). Aucun
 * d'eux ne connaît le tenant, Postgres, ni HTTP — ce sont les types d'ENTRÉE/SORTIE que
 * `orchestrateur-lecture.ts` assemble et que `service-rapprochement.ts` consomme. Cette coupure
 * est volontaire : la logique de RAPPROCHEMENT (qui décide de l'argent) reste testable à 100%
 * sans jamais dépendre de la qualité d'extraction d'un vrai PDF — voir le rapport de livraison.
 */

/** Une valeur d'en-tête accompagnée de SA provenance — jamais une valeur nue : `qr` est certain,
 *  `texte_pdf` quasi certain, `ocr` jamais certain (voir `contrats/pieces/enums.ts`). */
export interface ChampExtrait<T> {
  readonly valeur: T;
  readonly origine: OrigineDonneeFacture;
}

/** Tout est optionnel : chaque étape de la chaîne ne remplit que ce qu'elle a trouvé, jamais une
 *  valeur devinée. `orchestrateur-lecture.ts` fusionne QR puis texte PDF puis OCR SANS jamais
 *  écraser un champ déjà rempli par une étape antérieure plus fiable (le QR prime toujours). */
export interface EnTeteFactureExtrait {
  readonly ibanCreancier?: ChampExtrait<string>;
  readonly nomCreancier?: ChampExtrait<string>;
  readonly montantTotalCentimes?: ChampExtrait<number>;
  readonly devise?: ChampExtrait<string>;
  readonly referencePaiement?: ChampExtrait<string>;
  readonly numeroFacture?: ChampExtrait<string>;
  /** ISO `aaaa-mm-jj`. */
  readonly dateFacture?: ChampExtrait<string>;
}

export interface LigneFactureExtraite {
  readonly referenceArticle: string | null;
  readonly designation: string | null;
  readonly quantiteMillieme: number;
  readonly prixUnitaireCentimes: number | null;
  readonly totalLigneCentimes: number | null;
  readonly origine: OrigineDonneeFacture;
}

export interface DonneesFactureExtraites {
  readonly enTete: EnTeteFactureExtrait;
  readonly lignes: readonly LigneFactureExtraite[];
  /**
   * Texte intégral tel que reconstitué par la chaîne (texte du PDF, ou texte rendu par l'OCR de
   * repli) — `null` si aucun des deux n'a rien produit. Consommé par `service-rapprochement.ts`
   * pour retrouver, EXACTEMENT (sous-chaîne normalisée espaces/casse, jamais une distance
   * floue), la référence d'une commande fournisseur candidate dans le corps du document — le
   * Swiss QR Code ne porte aucun numéro de commande, seul le texte libre peut le contenir.
   */
  readonly texteIntegral: string | null;
  /**
   * Diagnostics libres, JAMAIS le contenu extrait (aucun montant, aucun nom — CONTRIBUTING.md
   * « journalisation ») : « aucun symbole QR détecté », « texte du PDF vide, image non exploitée
   * par l'extracteur de lignes », « service OCR non configuré ». Consommés par
   * `service-facture-fournisseur.ts` comme `avertissementsLecture` de la réponse — jamais
   * persistés tels quels (l'audit ne porte que des booléens/identifiants, même doctrine que
   * `vehicule_ocr_scan_journal`).
   */
  readonly diagnostics: readonly string[];
}
