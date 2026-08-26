import type { Page } from '@playwright/test';

/** Clé localStorage exacte posée par `next-themes` (`apps/web/src/composants/layout/
 *  BasculeTheme.tsx`) — valeur BRUTE `'light' | 'dark' | 'system'`, jamais du JSON. */
export const CLE_THEME_LOCALSTORAGE = 'dfa-theme';

/**
 * Force le thème AVANT le premier script de la page (script anti-flash synchrone en tête de
 * `apps/web/index.html`, qui lit cette même clé). `addInitScript` s'exécute avant tout script de
 * la page cible, sur CHAQUE navigation suivante — condition nécessaire pour prouver l'absence de
 * flash : si on posait la valeur APRÈS `goto`, le script anti-flash aurait déjà tourné sans elle.
 */
export async function forcerThemeAvantChargement(
  page: Page,
  theme: 'light' | 'dark',
): Promise<void> {
  await page.addInitScript(
    (cle, valeur) => window.localStorage.setItem(cle, valeur),
    CLE_THEME_LOCALSTORAGE,
    theme,
  );
}

/** `class` posée par `next-themes` (`attribute="class"`, App.tsx) sur `<html>` — jamais
 *  `data-theme`. Vaut `'dark'` ou `'light'` (jamais `'system'`, déjà résolu à ce stade). */
export async function classeHtml(page: Page): Promise<string> {
  return page.evaluate(() => document.documentElement.className);
}

/** Couleur de fond réellement peinte sur `<body>` — preuve que le thème n'est pas qu'une classe
 *  posée sans effet visuel (le jeton `--background`/`.dark` doit réellement changer la peinture). */
export async function couleurFondBody(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}
