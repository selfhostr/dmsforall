/**
 * Schéma Drizzle de l'étape 3 (pièces).
 * Toute table ajoutée dans ce répertoire DOIT être exportée depuis ce fichier ET depuis
 * `schema/index.ts`, sinon elle n'existe pas pour le typage des transactions.
 */

export * from './enums';
export * from './fournisseur';
export * from './article';
export * from './commande-fournisseur';
export * from './stock';
export * from './reservation';
export * from './consigne';
export * from './parametrage';
