import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { BlocPretCourtoisieOr } from './BlocPretCourtoisieOr';

function pret(surcharges: Record<string, unknown>) {
  return {
    id: 'p-1',
    vehiculeCourtoisieId: 'v-1',
    vehiculeDesignation: 'Fiat Panda',
    vehiculePlaque: 'VS 111',
    clientId: 'cl-1',
    clientNom: 'Jean Dupont',
    ordreReparationId: 'or-1',
    rendezVousId: null,
    debutLe: '2026-08-04T08:00:00.000Z',
    finPrevueLe: '2026-08-06T17:00:00.000Z',
    renduLe: null,
    kmDepart: null,
    kmRetour: null,
    statut: 'en_cours',
    enRetard: false,
    note: null,
    creeLe: '2026-08-04T08:00:00.000Z',
    ...surcharges,
  };
}

function rendre() {
  server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
  return render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <BlocPretCourtoisieOr orId="or-1" />
    </QueryClientProvider>,
  );
}

describe('BlocPretCourtoisieOr', () => {
  it('filtre la requête sur cet OR et dit quelle voiture est prêtée, depuis quand', async () => {
    let ordreReparationId: string | null = null;
    server.use(
      http.get('/api/v1/courtoisie/prets', ({ request }) => {
        ordreReparationId = new URL(request.url).searchParams.get('ordreReparationId');
        return HttpResponse.json({ donnees: [pret({})], curseurSuivant: null, limite: 50 });
      }),
    );
    rendre();
    expect(
      await screen.findByText('Voiture de courtoisie : Fiat Panda (VS 111), prêtée le 04.08.2026'),
    ).toBeInTheDocument();
    expect(ordreReparationId).toBe('or-1');
  });

  it("n'affiche rien quand aucun prêt n'est lié, ni pour un prêt annulé", async () => {
    server.use(
      http.get('/api/v1/courtoisie/prets', () =>
        HttpResponse.json({
          donnees: [pret({ statut: 'annule' })],
          curseurSuivant: null,
          limite: 50,
        }),
      ),
    );
    const { container } = rendre();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText(/Voiture de courtoisie/)).not.toBeInTheDocument();
    expect(container.querySelector('li')).toBeNull();
  });

  it('une erreur de chargement est dite, avec un bouton pour réessayer', async () => {
    server.use(
      http.get('/api/v1/courtoisie/prets', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: 'req-9',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    rendre();
    expect(
      await screen.findByRole('button', { name: 'Réessayer' }, { timeout: 5000 }),
    ).toBeInTheDocument();
  });
});
