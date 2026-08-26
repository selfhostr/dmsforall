import { expect, test, type Page } from '@playwright/test';

/**
 * Les six entrées de la barre latérale (`composants/layout/navigation-modele.ts`,
 * `ENTREES_MENU`) — landmark unique `<nav aria-label="Navigation principale">`
 * (`BarreLaterale.tsx`). Chaque entrée est un `<Link>` avec `aria-label` = libellé traduit,
 * `aria-current="page"` sur le lien actif. Route/titre H1 relevés dans le code source (jamais
 * devinés) : `routes/chemins.ts`, `composants/layout/navigation-modele.ts`
 * (`ONGLETS_*[0].chemin`, premier onglet = onglet par défaut de l'entrée pour le rôle
 * `direction`) et la clé i18n `titre`/`liste.titre` de chaque écran.
 */
const ENTREES = [
  { libelle: "Aujourd'hui", url: /\/tableau-bord/, titreEcran: 'Tableau de bord' },
  { libelle: 'Atelier', url: /\/ordres-reparation/, titreEcran: 'Ordres de réparation' },
  { libelle: 'Clients & véhicules', url: /\/clients/, titreEcran: 'Clients' },
  { libelle: 'Pièces', url: /\/pieces\/recherche-comptoir/, titreEcran: 'Recherche comptoir' },
  { libelle: 'Facturation', url: /\/factures/, titreEcran: 'Factures' },
  { libelle: 'Ventes', url: /\/ventes\/dossiers/, titreEcran: 'Dossiers de vente' },
] as const;

function navPrincipale(page: Page) {
  return page.getByRole('navigation', { name: 'Navigation principale' });
}

test.describe('Navigation — barre latérale', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tableau-bord');
    await expect(page.getByRole('heading', { level: 1, name: 'Tableau de bord' })).toBeVisible();
  });

  for (const entree of ENTREES) {
    test(`« ${entree.libelle} » mène à un écran réellement rendu`, async ({ page }) => {
      const lien = navPrincipale(page).getByRole('link', { name: entree.libelle, exact: true });
      await lien.click();

      await expect(page).toHaveURL(entree.url);
      // Pas seulement l'URL : le titre de tâche de l'écran (h1, `GabaritEcran`, TOUJOURS présent
      // même sr-only) prouve que le composant cible a réellement monté et rendu son contenu —
      // c'est le piège CONTRIBUTING.md « HTTP 200 sur la racine ne prouve rien », décliné côté SPA.
      await expect(page.getByRole('heading', { level: 1, name: entree.titreEcran })).toBeVisible();
      // Lien actif marqué par le modèle de navigation lui-même, pas seulement visible à l'oeil.
      await expect(lien).toHaveAttribute('aria-current', 'page');
    });
  }

  test('un seul lien porte aria-current="page" à la fois', async ({ page }) => {
    await navPrincipale(page).getByRole('link', { name: 'Facturation', exact: true }).click();
    await expect(page).toHaveURL(/\/factures/);
    await expect(navPrincipale(page).getByRole('link', { current: 'page' })).toHaveCount(1);
  });
});
