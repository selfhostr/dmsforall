/**
 * Jeton d'injection de `ServiceCompteurs`. `Symbol.for` (registre global du runtime), comme
 * `JETON_DB` / `JETON_IDEMPOTENCE` / `JETON_EVENEMENTS` / `JETON_AUDIT` : les modules clients
 * (numéro de client, RM-11) et atelier (numéro d'OR, RM-49) l'obtiennent sans dépendre de la
 * classe concrète NI importer `apps/api/src/parametrage/**` — deux appels indépendants à
 * `Symbol.for('DFA_COMPTEURS')` rendent EXACTEMENT le même symbole.
 *
 * Assigné à L1-07 par `plan-lot1-execution.md` §L1-07 (« ServiceCompteurs »), consommé par L1-08
 * (clients) et L1-12 (atelier) — ni l'un ni l'autre n'était livré au moment où ce fichier a été
 * écrit. Le nom du jeton et la forme de `ServiceCompteurs` (voir `compteurs.types.ts`) sont donc
 * une PROPOSITION de ce module, à confirmer par lead-backend si un autre nom a été supposé
 * ailleurs en parallèle.
 */
export const JETON_COMPTEURS = Symbol.for('DFA_COMPTEURS');
