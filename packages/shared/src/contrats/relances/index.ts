/**
 * Contrats du module relances automatiques (`docs/specification-relances-automatiques.md`).
 *
 * Lot 1 (facturation, rappel #2) : enums complets des 9 types/6 objets/machine à états (§2, §5,
 * §8 — posés une fois pour tous les lots), et les DTOs de ce lot seulement (config
 * `regle_relance`, déclenchement manuel de planification/envoi). Les DTOs de listing
 * (`relance_planifiee`, `relance_envoi`) sont laissés aux lots qui exposent un écran — voir le
 * rapport de livraison de ce lot pour ce qui reste à ajouter.
 */

export * from './enums';
export * from './regle-relance';
