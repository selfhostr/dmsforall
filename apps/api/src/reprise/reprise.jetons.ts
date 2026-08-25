/**
 * Jetons d'injection et constantes BullMQ du module reprise — même doctrine que
 * `exploitation/cycle-vie-tenant/cycle-vie-tenant.jetons.ts` : noms de file en constantes
 * partagées entre le déclencheur (`Queue.add`) et le `@Processor`, jamais une chaîne dupliquée.
 */

export const NOM_FILE_ANALYSE_REPRISE = 'reprise-analyse';
export const NOM_JOB_ANALYSE_REPRISE = 'analyser-dossier-reprise';

export const NOM_FILE_IMPORT_REPRISE = 'reprise-import';
export const NOM_JOB_IMPORT_REPRISE = 'importer-dossier-reprise';

/** Port de stockage des tranches/archive binaire — voir `depot/stockage-archive-reprise.ts`. */
export const JETON_STOCKAGE_ARCHIVE_REPRISE = Symbol('JETON_STOCKAGE_ARCHIVE_REPRISE');

/**
 * Port de lecture de l'archive source (famille de moteur, tables, lecture en flux, copie faisant
 * foi, rôle métier déduit) — implémenté par `apps/api/src/reprise/lecteurs/` (autre agent, EN
 * COURS au moment où ce module est écrit). Codé contre ce port, jamais contre l'implémentation
 * concrète : voir `lecture/port-lecteur-archive-reprise.ts` pour l'interface exacte et la
 * justification de ce découplage.
 */
export const JETON_LECTEUR_ARCHIVE_REPRISE = Symbol('JETON_LECTEUR_ARCHIVE_REPRISE');
