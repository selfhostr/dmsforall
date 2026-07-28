/**
 * Schéma Drizzle du lot 1 (étape 1 — atelier + clients).
 * Toute table ajoutée dans ce répertoire DOIT être exportée depuis ce fichier ET depuis
 * `schema/index.ts`, sinon elle n'existe pas pour le typage des transactions.
 */

export * from './enums';
export * from './audit';
export * from './idempotence';
export * from './evenement';
export * from './parametrage';
export * from './client';
export * from './vehicule';
export * from './ordre-reparation';
