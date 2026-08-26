import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { forcerThemeAvantChargement } from '../support/theme';

/**
 * Captures « après refonte » (mission explicite — seules les captures « avant » existaient).
 * Écrit dans le dépôt (chemin ci-dessous, `.gitignore`), PAS directement dans le scratchpad de
 * session : ce fichier doit rester utilisable par quiconque relance le harnais, pas seulement
 * dans CETTE session — voir e2e/README.md « Captures » pour l'étape de copie vers le scratchpad.
 */
const DOSSIER_CAPTURES = fileURLToPath(new URL('../captures-apres-refonte', import.meta.url));

test.describe('Captures après refonte', () => {
  test('tableau de bord et atelier — clair et sombre', async ({ page }) => {
    await forcerThemeAvantChargement(page, 'light');
    await page.goto('/tableau-bord');
    await expect(page.getByRole('heading', { level: 1, name: 'Tableau de bord' })).toBeVisible();
    await page.screenshot({
      path: `${DOSSIER_CAPTURES}/tableau-bord-clair.png`,
      fullPage: true,
    });

    await page.getByRole('button', { name: /passer en thème sombre/i }).click();
    await expect(page.locator('html')).toHaveClass('dark');
    await page.screenshot({
      path: `${DOSSIER_CAPTURES}/tableau-bord-sombre.png`,
      fullPage: true,
    });

    await page
      .getByRole('navigation', { name: 'Navigation principale' })
      .getByRole('link', { name: 'Atelier', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Ordres de réparation' }),
    ).toBeVisible();
    await page.screenshot({
      path: `${DOSSIER_CAPTURES}/atelier-sombre.png`,
      fullPage: true,
    });

    await page.getByRole('button', { name: /passer en thème clair/i }).click();
    await expect(page.locator('html')).toHaveClass('light');
    await page.screenshot({
      path: `${DOSSIER_CAPTURES}/atelier-clair.png`,
      fullPage: true,
    });
  });
});
