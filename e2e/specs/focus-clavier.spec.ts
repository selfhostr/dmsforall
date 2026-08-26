import { expect, test, type Page } from '@playwright/test';

/**
 * Focus clavier visible — `.anneau-focus`/`.anneau-focus-interne` (`index.css` ~ligne 900,
 * `--ring: var(--marque)`), `outline` posé sur `:focus-visible` avec une spécificité qui l'emporte
 * volontairement sur l'utilitaire Tailwind `outline-none` (cartographie fournie).
 *
 * De VRAIES pressions de touche `Tab` (`page.keyboard.press`), jamais `.focus()` programmatique :
 * `:focus-visible` est un heuristique du navigateur qui distingue justement l'origine de l'accès
 * (clavier vs souris/JS) — un `.focus()` direct ne prouverait rien sur ce que voit réellement un
 * utilisateur clavier.
 */
async function tabJusqua(
  page: Page,
  correspond: () => Promise<boolean>,
  maxTentatives = 60,
): Promise<void> {
  for (let tentative = 0; tentative < maxTentatives; tentative += 1) {
    if (await correspond()) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Élément non atteint au clavier après ${maxTentatives} tabulations.`);
}

/** `outline` non nul = anneau visible. Ne dépend pas de la classe CSS exacte posée par le
 *  composant (détail d'implémentation) : la garantie demandée porte sur le RENDU. */
async function anneauVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as Element);
    return style.outlineStyle !== 'none' && style.outlineWidth !== '0px';
  });
}

test.describe('Focus clavier', () => {
  test('la bascule de thème reçoit un anneau visible au clavier', async ({ page }) => {
    await page.goto('/tableau-bord');
    await expect(page.getByRole('heading', { level: 1, name: 'Tableau de bord' })).toBeVisible();

    await tabJusqua(page, async () =>
      page.evaluate(() => {
        const libelle = document.activeElement?.getAttribute('aria-label') ?? '';
        return /passer en thème/i.test(libelle);
      }),
    );
    expect(await anneauVisible(page)).toBe(true);
  });

  for (const libelle of [
    "Aujourd'hui",
    'Atelier',
    'Clients & véhicules',
    'Pièces',
    'Facturation',
    'Ventes',
  ]) {
    test(`le lien « ${libelle} » de la barre latérale reçoit un anneau visible au clavier`, async ({
      page,
    }) => {
      await page.goto('/tableau-bord');
      await expect(page.getByRole('heading', { level: 1, name: 'Tableau de bord' })).toBeVisible();

      await tabJusqua(page, async () =>
        page.evaluate(
          (texte) => document.activeElement?.getAttribute('aria-label') === texte,
          libelle,
        ),
      );
      expect(await anneauVisible(page)).toBe(true);
    });
  }
});
