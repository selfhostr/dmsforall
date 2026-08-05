/**
 * Schéma Drizzle du hangar à pneus (Lot A, `docs/specification-parc-et-hangar-pneus.md`).
 * Toute table ajoutée dans ce répertoire DOIT être exportée depuis ce fichier ET depuis
 * `schema/index.ts`, sinon elle n'existe pas pour le typage des transactions.
 */

export * from './enums';
export * from './depot-pneus';
