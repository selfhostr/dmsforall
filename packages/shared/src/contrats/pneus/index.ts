/**
 * Contrats du module pneus (hangar à pneus, `docs/specification-parc-et-hangar-pneus.md`).
 *
 * Point d'entrée du domaine. Pour l'instant : seulement les enums (Lot A, schéma). Les DTOs
 * (`POST /vehicules/{id}/depots-pneus`, `changer-saison`, `sortir`, etc., §5 de la spec) sont
 * ajoutés par un lot séparé, sur ce même barrel.
 */

export * from './enums';
export * from './depot-pneus';
