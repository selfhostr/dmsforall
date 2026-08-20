/**
 * Contrats du cycle de vie de sortie du garage d'un tenant (offboarding, migration 0062).
 * Voir `enums.ts` pour pourquoi ce domaine est séparé de `contrats/exploitation/` — arbitrage du
 * 20.08.2026 : la séparation reste justifiée même après la décision « droit métier ordinaire »
 * (voir `resiliation.ts`), un domaine de contrats propre plutôt que noyé dans `atelier`.
 */
export * from './enums';
export * from './resiliation';
