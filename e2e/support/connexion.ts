import { expect, type Page } from '@playwright/test';

import { IDENTIFIANTS_DEMO } from './identifiants';

/**
 * Connexion réelle (formulaire, pas d'injection de session) — cible `apps/web/src/ecrans/
 * EcranConnexion.tsx` : champs `id="email"`/`id="motDePasse"`, bouton `type="submit"`. Attend
 * l'arrivée effective sur `/tableau-bord` (redirection de `/`, `routes/routeur.tsx`) via le titre
 * de page (`GabaritEcran`, h1 TOUJOURS présent — voir e2e/README.md) plutôt qu'un `waitForURL`
 * seul : l'URL peut changer avant que l'écran ait fini de rendre son contenu réel (piège CONTRIBUTING.md
 * — « HTTP 200 sur la racine ne prouve rien »).
 */
export async function seConnecter(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('#email').fill(IDENTIFIANTS_DEMO.email);
  await page.locator('#motDePasse').fill(IDENTIFIANTS_DEMO.motDePasse);
  await page.getByRole('button', { name: /se connecter/i }).click();
  await expect(page).toHaveURL(/\/tableau-bord/);
  await expect(page.getByRole('heading', { level: 1, name: 'Tableau de bord' })).toBeVisible();
}
