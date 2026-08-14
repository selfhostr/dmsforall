/**
 * Contrats du module relances automatiques (`docs/specification-relances-automatiques.md`).
 *
 * Lot 1 (facturation, rappel #2) : enums complets des 9 types/6 objets/machine à états (§2, §5,
 * §8 — posés une fois pour tous les lots), et les DTOs de ce lot (config `regle_relance`,
 * déclenchement manuel de planification/envoi).
 *
 * Issue #136 (historique d'envoi) : `relance-envoi.ts` ajoute le DTO de listing de
 * `relance_envoi` — SEUL les deux mentionnés ci-dessus manquaient encore, `relance_planifiee`
 * (l'état courant d'une occasion, plutôt que le détail par tentative) reste hors périmètre de
 * cette issue, laissé à un futur lot qui en aurait besoin.
 */

export * from './enums';
export * from './regle-relance';
export * from './relance-envoi';
