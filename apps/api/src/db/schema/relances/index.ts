/**
 * Schéma Drizzle des relances automatiques (lot 1 — facturation, rappel #2).
 * Toute table ajoutée dans ce répertoire DOIT être exportée depuis ce fichier ET depuis
 * `schema/index.ts`, sinon elle n'existe pas pour le typage des transactions.
 */

export * from './enums';
export * from './regle-relance';
export * from './relance-planifiee';
export * from './relance-envoi';
