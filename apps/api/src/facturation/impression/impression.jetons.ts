/**
 * Jeton d'injection pour `StockagePdf` — même doctrine que `JETON_DB`/`JETON_IDEMPOTENCE` ailleurs
 * dans le produit (voir `db/index.ts`) : les services dépendent du jeton, jamais de la classe
 * concrète, pour permettre un adaptateur de production (S3-compatible) sans toucher au service.
 */
export const JETON_STOCKAGE_PDF = Symbol.for('DFA_STOCKAGE_PDF');
