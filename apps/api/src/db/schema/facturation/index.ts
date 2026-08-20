/**
 * Schéma Drizzle de l'étape 2 (facturation).
 * Toute table ajoutée dans ce répertoire DOIT être exportée depuis ce fichier ET depuis
 * `schema/index.ts`, sinon elle n'existe pas pour le typage des transactions.
 */

export * from './enums';
export * from './transitions';
export * from './periode-comptable';
export * from './document-vente';
export * from './paiement';
export * from './export';
export * from './tenant-bloc-creancier';
export * from './report-reglement-correction';
