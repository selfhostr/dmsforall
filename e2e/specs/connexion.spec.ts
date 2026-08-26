import { expect, test } from '@playwright/test';

import { analyserAccessibilite } from '../support/accessibilite';
import { IDENTIFIANTS_DEMO } from '../support/identifiants';

/**
 * Parcours de connexion réel — `apps/web/src/ecrans/EcranConnexion.tsx`. Aucun `data-testid`
 * dans ce composant (cartographie fournie) : ciblage par rôle ARIA/texte, comme le reste du
 * harnais.
 */
test.describe('Connexion', () => {
  test('a11y (WCAG AA) — écran de connexion', async ({ page }) => {
    await page.goto('/login');
    const { violations, resume } = await analyserAccessibilite(page, test.info(), 'connexion');
    expect(violations, `Violations WCAG AA sur /login :\n${resume}`).toEqual([]);
  });

  test('identifiants valides -> tableau de bord', async ({ page }) => {
    await page.goto('/login');
    await page.locator('#email').fill(IDENTIFIANTS_DEMO.email);
    await page.locator('#motDePasse').fill(IDENTIFIANTS_DEMO.motDePasse);
    await page.getByRole('button', { name: /se connecter/i }).click();

    await expect(page).toHaveURL(/\/tableau-bord/);
    // Preuve que l'écran a vraiment rendu, pas seulement que l'URL a changé (piège CONTRIBUTING.md).
    await expect(page.getByRole('heading', { level: 1, name: 'Tableau de bord' })).toBeVisible();
  });

  test('mot de passe refusé -> alerte « identifiants », champ mot de passe vidé', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.locator('#email').fill(IDENTIFIANTS_DEMO.email);
    await page.locator('#motDePasse').fill('un-mauvais-mot-de-passe');
    await page.getByRole('button', { name: /se connecter/i }).click();

    // Une des trois catégories du contrat (identifiants/serveur/réseau) — `Alert
    // variant="destructive"` pour un refus serveur d'identifiants.
    const alerte = page.getByRole('alert');
    await expect(alerte).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    // E-mail conservé, mot de passe effacé (contrat cité en tête d'EcranConnexion.tsx) — hygiène
    // + le message ne révèle jamais lequel des deux champs est en cause.
    await expect(page.locator('#email')).toHaveValue(IDENTIFIANTS_DEMO.email);
    await expect(page.locator('#motDePasse')).toHaveValue('');
  });
});
