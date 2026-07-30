/**
 * Contrats du lot 2 — Pointage.
 *
 * Sources : RM-87 → RM-99 (posées à l'étape 1, `specification-etape-1-atelier-clients.md`),
 * RM-113 → RM-123, P-33/P-34, CT-53 → CT-57 (posés par `docs/specification-pointage.md`), en
 * continuité de CT-34/CT-37 → CT-44 déjà écrits.
 *
 * Point d'entrée du domaine, même règle que `contrats/atelier/index.ts`,
 * `contrats/facturation/index.ts` et `contrats/pieces/index.ts` : tout ce qui est exporté ici est
 * GELÉ au nom près et à la signature près une fois validé par l'orchestrateur. Un écart
 * nécessaire se remonte, il ne se code pas « en attendant ».
 *
 * `primitives.ts` n'est PAS réexporté ici — même règle que `pieces/primitives.ts` et
 * `facturation/primitives.ts` : ses symboles sont internes au domaine pointage, et les primitives
 * génériques déjà publiques restent celles de `contrats/atelier/primitives`.
 *
 * Les enums déclarés PAR AVANCE au lot 1 (`StatutPointage`, `SourcePointage`,
 * `NatureActivitePointage`, `StatutPeriodePointage`) restent dans `contrats/atelier/enums.ts` et
 * ne sont PAS réexportés ici non plus — le barrel racine (`@dfa/shared`) les rend déjà disponibles
 * via `export * from './contrats/atelier'`. Les réexporter ici les dupliquerait sous le même nom
 * et rendrait l'export ambigu (silencieusement omis par TypeScript, la même mise en garde que
 * `pieces/index.ts`).
 *
 * Règle de compatibilité opposable à toute revue future, reprise à l'identique des autres
 * domaines : un client de cette API doit ignorer les champs qu'il ne connaît pas et ne doit
 * jamais échouer sur une valeur d'enum inconnue.
 */

export * from './enums';
export * from './identification';
export * from './pointage';
export * from './periode';
export * from './indicateurs';
