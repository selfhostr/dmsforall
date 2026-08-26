import { expect, test } from '@playwright/test';

import {
  classeHtml,
  CLE_THEME_LOCALSTORAGE,
  couleurFondBody,
  forcerThemeAvantChargement,
} from '../support/theme';

/**
 * Bascule clair/sombre (`composants/layout/BasculeTheme.tsx`, `next-themes`). Points du contrat
 * (cartographie fournie) : classe `class="dark"|"light"` sur `<html>` (jamais `data-theme`),
 * persistance `localStorage` clé `dfa-theme` en chaîne BRUTE (jamais du JSON), script anti-flash
 * synchrone en tête de `apps/web/index.html`.
 */
test.describe('Thème clair/sombre', () => {
  test('bascule : classe html, couleur de fond, et localStorage changent réellement', async ({
    page,
  }) => {
    await page.goto('/tableau-bord');
    await expect(page.getByRole('heading', { level: 1, name: 'Tableau de bord' })).toBeVisible();

    const classeInitiale = await classeHtml(page);
    const couleurInitiale = await couleurFondBody(page);

    const bouton = page.getByRole('button', { name: /passer en thème/i });
    await bouton.click();

    await expect(page.locator('html')).not.toHaveClass(classeInitiale);
    const classeApres = await classeHtml(page);
    expect(['dark', 'light']).toContain(classeApres);
    expect(classeApres).not.toBe(classeInitiale);

    // La classe seule ne suffit pas à prouver que le thème a un effet réel — la peinture doit
    // changer (jeton `--background` réellement consommé, pas une classe posée sans styles liés).
    const couleurApres = await couleurFondBody(page);
    expect(couleurApres).not.toBe(couleurInitiale);

    // Persistance en chaîne BRUTE, jamais du JSON (piège cartographié : `JSON.parse('dark')`
    // lèverait).
    const valeurStockee = await page.evaluate(
      (cle) => window.localStorage.getItem(cle),
      CLE_THEME_LOCALSTORAGE,
    );
    expect(valeurStockee).toBe(classeApres);
  });

  test('le choix survit à un rechargement complet', async ({ page }) => {
    await page.goto('/tableau-bord');
    await page.getByRole('button', { name: /passer en thème/i }).click();
    const classeApresBascule = await classeHtml(page);

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Tableau de bord' })).toBeVisible();
    await expect(page.locator('html')).toHaveClass(classeApresBascule);
  });

  test('aucun flash clair au chargement en mode sombre', async ({ page }) => {
    // Pose `dfa-theme=dark` en localStorage AVANT tout script de la page — y compris le script
    // anti-flash synchrone en tête de `index.html`, qui lit cette même clé. Sans ce réglage posé
    // en amont, ce test ne prouverait rien : le script anti-flash n'aurait rien à lire.
    await forcerThemeAvantChargement(page, 'dark');

    // `domcontentloaded`, pas `load` (défaut de `goto`) : c'est le point le plus tôt où on peut
    // vérifier le DOM après l'exécution de TOUS les scripts synchrones de <head> (dont le script
    // anti-flash), mais avant que le reste de la page (styles/images) finisse de charger. Si la
    // classe sombre n'était posée que plus tard (ex. un `useEffect` React après montage — le
    // défaut exact qui causerait le flash), elle ne serait pas encore là à ce point.
    await page.goto('/tableau-bord', { waitUntil: 'domcontentloaded' });

    expect(await classeHtml(page)).toBe('dark');
  });
});
