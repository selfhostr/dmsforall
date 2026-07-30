/**
 * Jetons d'injection du domaine `facturation/export` — même doctrine que
 * `parametrage/compteurs/compteurs.jetons.ts` (`Symbol.for`, registre global du runtime) : un
 * futur service d'orchestration d'export (hors périmètre de ce lot) obtient l'adaptateur WinBIZ
 * sans importer directement `facturation/export/winbiz/**`.
 *
 * `JETON_EXPORTEUR_WINBIZ` est la clé prévue pour enregistrer `WinbizExporteurService` — voir
 * `export.module.ts`.
 */
export const JETON_EXPORTEUR_WINBIZ = Symbol.for('DFA_EXPORTEUR_WINBIZ');
