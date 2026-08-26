import { expect, test } from '@playwright/test';

/**
 * Les trois états obligatoires (CONTRIBUTING.md, `composants/commun/Etat{Chargement,Erreur,Vide}.tsx`)
 * — vérifiés sur `/ordres-reparation` (`EcranListeOrdresReparation.tsx`), le seul écran de la
 * cartographie dont le code source a été lu en détail pour CE harnais et qui les câble tous les
 * trois explicitement (`isPending` -> squelette, `isError` -> alerte, recherche sans résultat ->
 * vide). Endpoint intercepté : `GET /api/v1/ordres-reparation` (`hooks/atelier/
 * ordres-reparation.api.ts`).
 *
 * Pas de `waitForTimeout` arbitraire : le seul délai de ce fichier retarde volontairement une
 * réponse RÉSEAU INTERCEPTÉE (condition observable et contrôlée) pour rendre l'état de chargement
 * assez long à observer — l'assertion elle-même reste une attente Playwright normale (auto-retry
 * sur un état réel), jamais un sommeil aveugle dans le corps du test.
 */
const MOTIF_ENDPOINT_OR = '**/api/v1/ordres-reparation**';

test.describe('États d’écran — Ordres de réparation', () => {
  test('chargement : squelette annoncé (role=status) avant les données', async ({ page }) => {
    await page.route(MOTIF_ENDPOINT_OR, async (route) => {
      // Retarde le début de la vraie requête réseau — pas la lecture de la réponse : le composant
      // reste en `isPending` (donc en squelette) pendant toute cette fenêtre.
      await new Promise((resoudre) => setTimeout(resoudre, 800));
      await route.continue();
    });

    await page.goto('/ordres-reparation');

    const chargement = page.getByRole('status');
    await expect(chargement).toBeVisible();

    // Puis résolution réelle : le squelette cède la place à un contenu réel (liste ou vide), pas
    // à une page qui reste bloquée.
    await expect(chargement).toBeHidden({ timeout: 10_000 });
  });

  test('vide (recherche) : texte utile, pas une page blanche', async ({ page }) => {
    await page.goto('/ordres-reparation');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Ordres de réparation' }),
    ).toBeVisible();

    const recherche = page.getByRole('searchbox', { name: 'Rechercher' });
    await recherche.fill('zzzz-immatriculation-improbable-9999');

    // La recherche est debouncée côté écran : attendre la réponse réseau réelle plutôt qu'un
    // délai arbitraire — c'est l'événement observable qui marque la fin du debounce + du fetch.
    await page.waitForResponse((reponse) => reponse.url().includes('/api/v1/ordres-reparation'));

    await expect(page.getByRole('heading', { level: 2, name: 'Aucun OR trouvé' })).toBeVisible();
    await expect(
      page.getByText('Aucun ordre de réparation ne correspond à cette recherche.'),
    ).toBeVisible();
  });

  test('erreur : alerte actionnable (role=alert + Réessayer), la reprise fonctionne', async ({
    page,
  }) => {
    // Grille sur le CLIC de « Réessayer », jamais sur un compteur du premier appel : contre la
    // cible dev (`React.StrictMode`, `apps/web/src/main.tsx`), React invoque les effets deux fois
    // au montage — TanStack Query émet donc DEUX requêtes initiales, pas une. Un compteur
    // « premier appel = échec » consommait le mock 500 sur l'appel surnuméraire de StrictMode ; le
    // rendu affiché venait alors du second appel, déjà réussi — l'alerte n'apparaissait jamais
    // (mesuré : `getByRole('alert')` introuvable, capture montrant la liste réelle chargée avec
    // succès). Ce comportement est spécifique au DEV (StrictMode ne double pas les effets en
    // build de production) — grille sur la reprise explicite rend le test correct dans les deux
    // cibles.
    let reessaiDemande = false;
    await page.route(MOTIF_ENDPOINT_OR, async (route) => {
      if (!reessaiDemande) {
        await route.fulfill({
          status: 500,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            type: 'about:blank',
            title: 'Erreur interne',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: '/api/v1/ordres-reparation',
          }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto('/ordres-reparation');

    const alerte = page.getByRole('alert');
    // Délai généreux, pas arbitraire : `App.tsx` ne redéfinit pas `retry` sur le `QueryClient` —
    // défaut TanStack Query `retry: 3` + `retryDelay` exponentiel (~1s/2s/4s, ~7s cumulés) avant
    // que la requête passe réellement en erreur. Un timeout par défaut (10s) peut ne pas suffire
    // une fois ajoutés les aller-retours réseau eux-mêmes — mesuré : la capture d'un run en échec
    // montre le squelette de chargement encore affiché à 10s, jamais l'alerte. Champ toujours
    // observable (l'assertion réussit dès que l'alerte apparaît, pas de sommeil fixe).
    await expect(alerte).toBeVisible({ timeout: 20_000 });
    await expect(
      alerte.getByRole('heading', {
        level: 2,
        name: 'Impossible de charger les ordres de réparation',
      }),
    ).toBeVisible();
    const boutonReessayer = alerte.getByRole('button', { name: 'Réessayer' });
    await expect(boutonReessayer).toBeVisible();

    // La reprise doit vraiment fonctionner, pas seulement afficher un bouton : à partir d'ici,
    // toute requête passe par `route.continue()` ci-dessus (vraie requête vers l'API réelle).
    reessaiDemande = true;
    await boutonReessayer.click();
    await expect(alerte).toBeHidden({ timeout: 10_000 });
  });
});
