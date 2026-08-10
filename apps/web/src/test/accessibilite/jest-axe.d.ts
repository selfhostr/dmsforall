/**
 * Déclaration de types locale pour `jest-axe` (voir `harnais.ts` pour le choix de ce paquet).
 *
 * `jest-axe` ne publie AUCUN `.d.ts` lui-même (vérifié : `node_modules/jest-axe/` ne contient que
 * `index.js`). Le paquet communautaire `@types/jest-axe` existe mais plafonne à `3.5.9` (dernière
 * publication 2025-08-03) et pin `axe-core@^3.5.5` en dépendance — une API `jest-axe` v3 obsolète,
 * jamais mise à jour vers `configureAxe`/`AxeResults` modernes. L'installer à côté de notre
 * `axe-core@4.13` direct fait cohabiter DEUX versions majeures différentes des types `axe-core`
 * dans le même projet et casse `tsc --noEmit` (types `AxeResults`/`RuleObject` incompatibles entre
 * eux). Constaté en exécution sur ce dépôt, pas une supposition — voir l'historique de
 * `apps/web/package.json`. Solution : ne pas dépendre de `@types/jest-axe`, déclarer ici
 * uniquement la forme réellement utilisée (`configureAxe`), typée contre NOTRE `axe-core`.
 */
declare module 'jest-axe' {
  import type { RunOptions, Spec, AxeResults } from 'axe-core';

  export type JestAxe = (html: Element | string, options?: RunOptions) => Promise<AxeResults>;

  export interface JestAxeConfigureOptions extends RunOptions {
    readonly globalOptions?: Spec;
  }

  export function configureAxe(options?: JestAxeConfigureOptions): JestAxe;
}
