/**
 * Schéma Drizzle de l'étape 4 (ventes VN/VO).
 * Toute table ajoutée dans ce répertoire DOIT être exportée depuis ce fichier ET depuis
 * `schema/index.ts` (posé par l'orchestrateur — hors périmètre d'écriture de ce module, voir le
 * rapport de livraison), sinon elle n'existe pas pour le typage des transactions.
 */

export * from './enums';
export * from './vehicule-stock';
export * from './dossier-vente';
export * from './document-requis';
export * from './reprise';
export * from './financement';
