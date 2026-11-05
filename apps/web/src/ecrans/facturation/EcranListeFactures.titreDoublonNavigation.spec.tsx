import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { routesConfig } from '@/routes/routeur';
import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { renduAvecRoutes } from '@/test/utils';

/**
 * MESURE (retour produit du 17.08.2026, « il y a toujours "Factures" en haut ») — reproduit la VRAIE
 * route (`/factures`, celle de `chemins.facturation.liste`/`routeur.tsx`, jamais `/`), avec un rôle
 * qui voit RÉELLEMENT la rangée d'onglets de la navigation Facturation.
 *
 * Le rôle compte : `navigation-modele.ts` déclare deux onglets sous l'entrée Facturation —
 * « Factures » (`ROLES_MENU_FACTURATION`, sept rôles) et « Relances » (`ROLES_RELANCES`, SEULEMENT
 * `direction`/`comptable`). `OngletsDomaine` ne rend la rangée que si elle offre PLUS D'UN choix
 * (`afficheOnglets = onglets.length > 1`, `useNavigationActive.ts`). Pour `chef_atelier` (rôle par
 * défaut de `SESSION_TEST`), seul « Factures » est visible : la rangée d'onglets ne s'affiche PAS,
 * son libellé n'entre donc jamais dans `useLibellesNavigationAffiches`, et le doublon ne serait
 * JAMAIS détecté — un test avec ce rôle par défaut aurait rendu un FAUX négatif. `direction` voit
 * les deux onglets : c'est le seul rôle qui expose réellement la comparaison à mesurer.
 */
function connecterDirection() {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({
        ...SESSION_TEST,
        utilisateur: { ...SESSION_TEST.utilisateur, role: 'direction' },
      }),
    ),
    http.get('/api/v1/documents-vente', () =>
      HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
    ),
  );
}

describe('EcranListeFactures — titre en doublon avec la navigation (retour @laupernoe 17.08.2026)', () => {
  it('masque le h1 "Factures" en sr-only sur la vraie route /factures, pour un rôle qui voit la rangée d’onglets Facturation', async () => {
    connecterDirection();

    renduAvecRoutes(routesConfig, { routeInitiale: '/factures' });

    // Onglet « Toutes » sert de repère : sa présence prouve que l'écran réel (pas l'écran de refus
    // de rôle) est bien monté, avant de statuer sur le h1.
    await screen.findByRole('tab', { name: 'Toutes' });

    // Re-interroge le DOM à CHAQUE tour de `waitFor` (pas de référence capturée une fois) :
    // `GabaritEcran` peut basculer entre sa forme "sans ligne d'en-tête" et sa forme normale le
    // temps que le rôle de session se résout (`useRoleSession`), ce qui REMONTE le nœud h1 — une
    // référence figée deviendrait un nœud détaché portant l'ancienne classe.
    await waitFor(() => {
      const titre = screen.getByRole('heading', { level: 1, name: 'Factures' });
      expect(titre).toBeInTheDocument();
      expect(titre.className).toMatch(/\bsr-only\b/);
    });
  });
});
