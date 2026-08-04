import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import type { ClientResume } from '@dfa/shared';

import i18n from '@/i18n';
import { server } from '@/test/msw/server';
import { renduAvecRoutes } from '@/test/utils';

import { EcranListeClients } from './EcranListeClients';

const CLIENT_TEST: ClientResume = {
  id: 'cl-1',
  numeroClient: 'CL-000123',
  nomAffiche: 'Jean Dupont',
  type: 'particulier',
  statut: 'actif',
  langueCorrespondance: 'fr',
  poObligatoire: false,
  telephone: '+41791234567',
  localite: 'Lausanne',
  nombreVehicules: 2,
  dernierPassageLe: '2026-06-01T10:00:00.000Z',
};

function rendreEcran(routeInitiale = '/clients') {
  return renduAvecRoutes(
    [
      { path: '/clients', element: <EcranListeClients /> },
      { path: '/clients/:id', element: <div>PAGE_FICHE_CLIENT</div> },
    ],
    { routeInitiale },
  );
}

function repondreListe(donnees: readonly ClientResume[]) {
  server.use(
    http.get('/api/v1/clients', () =>
      HttpResponse.json({ donnees, curseurSuivant: null, limite: 50 }),
    ),
  );
}

describe('EcranListeClients', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('affiche les clients renvoyés par le serveur', async () => {
    repondreListe([CLIENT_TEST]);
    rendreEcran();

    expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();
    expect(screen.getByText('CL-000123')).toBeInTheDocument();
    expect(screen.getByText('Lausanne')).toBeInTheDocument();
  });

  it('affiche des lignes squelette pendant le chargement', async () => {
    server.use(
      http.get('/api/v1/clients', async () => {
        await delay(30);
        return HttpResponse.json({ donnees: [CLIENT_TEST], curseurSuivant: null, limite: 50 });
      }),
    );
    const { container } = rendreEcran();

    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();
  });

  it("affiche l'état « premier usage » quand la liste est vide sans filtre actif", async () => {
    repondreListe([]);
    rendreEcran();

    expect(
      await screen.findByText('Aucun client enregistré. Créez le premier.'),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Nouveau client' }).length).toBeGreaterThan(0);
  });

  it("affiche un état d'erreur actionnable si le serveur répond en erreur", async () => {
    server.use(
      http.get('/api/v1/clients', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur interne',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: 'req-1',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    rendreEcran();

    expect(await screen.findByRole('button', { name: /Réessayer/ })).toBeInTheDocument();
  });

  it('traduit les libellés en allemand', async () => {
    await i18n.changeLanguage('de');
    repondreListe([]);
    rendreEcran();

    expect(
      await screen.findByText('Kein Kunde registriert. Erstellen Sie den ersten.'),
    ).toBeInTheDocument();
  });

  describe('propagation du site (?site=) au clic sur une ligne', () => {
    it('conserve `?site=` en ouvrant la fiche client', async () => {
      repondreListe([CLIENT_TEST]);
      const utilisateur = userEvent.setup();
      const { routeur } = rendreEcran('/clients?site=site-1');

      await utilisateur.click(await screen.findByText('Jean Dupont'));

      expect(await screen.findByText('PAGE_FICHE_CLIENT')).toBeInTheDocument();
      expect(routeur.state.location.pathname).toBe('/clients/cl-1');
      expect(routeur.state.location.search).toBe('?site=site-1');
    });

    it('ne réinvente pas de `site` en ouvrant la fiche client quand il est absent de l’URL', async () => {
      repondreListe([CLIENT_TEST]);
      const utilisateur = userEvent.setup();
      const { routeur } = rendreEcran('/clients');

      await utilisateur.click(await screen.findByText('Jean Dupont'));

      expect(await screen.findByText('PAGE_FICHE_CLIENT')).toBeInTheDocument();
      expect(routeur.state.location.search).toBe('');
    });
  });
});
