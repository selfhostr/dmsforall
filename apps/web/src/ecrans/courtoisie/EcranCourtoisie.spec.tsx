import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranCourtoisie } from './EcranCourtoisie';

function installerSession(role: (typeof SESSION_TEST)['utilisateur']['role']) {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      HttpResponse.json({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, role } }),
    ),
  );
}

const PRET = {
  id: 'p1',
  vehiculeCourtoisieId: 'c2',
  vehiculeDesignation: 'Seat Ibiza',
  vehiculePlaque: null,
  clientId: 'cl1',
  clientNom: 'Dupont Jean',
  ordreReparationId: null,
  rendezVousId: null,
  debutLe: '2026-11-12T07:00:00.000Z',
  finPrevueLe: '2026-11-12T17:00:00.000Z',
  renduLe: null,
  kmDepart: 1000,
  kmRetour: null,
  statut: 'en_cours',
  enRetard: false,
  note: null,
  creeLe: '2026-11-12T07:00:00.000Z',
};

function installerParc(vehicules: unknown[]) {
  server.use(
    http.get('/api/v1/courtoisie/vehicules', () =>
      HttpResponse.json({
        du: '2026-11-12T00:00:00.000Z',
        au: '2026-11-13T00:00:00.000Z',
        vehicules,
      }),
    ),
  );
}

function rendre() {
  return render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <EcranCourtoisie />
    </QueryClientProvider>,
  );
}

const LIBRE = {
  id: 'c1',
  designation: 'VW Polo',
  plaque: 'VS 111 222',
  kilometrage: 1000,
  etat: 'disponible',
  note: null,
  disponibilite: 'libre',
  pretSurPeriode: null,
};
const OCCUPE = {
  ...LIBRE,
  id: 'c2',
  designation: 'Seat Ibiza',
  plaque: null,
  disponibilite: 'occupe',
  pretSurPeriode: PRET,
};

describe('EcranCourtoisie', () => {
  it('affiche le parc, le nombre de voitures libres, et « Prêter » / « Rendu » selon l’état', async () => {
    installerSession('receptionnaire');
    installerParc([LIBRE, OCCUPE]);
    rendre();

    expect(await screen.findByText('VW Polo')).toBeInTheDocument();
    expect(screen.getByText('1 voiture libre sur 2')).toBeInTheDocument();
    expect(screen.getByText('Dupont Jean')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prêter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rendu' })).toBeInTheDocument();
    // La réceptionniste ne gère pas le parc.
    expect(screen.queryByRole('button', { name: 'Ajouter une voiture' })).not.toBeInTheDocument();
  });

  it('un technicien consulte sans pouvoir prêter ; l’état vide est explicite', async () => {
    installerSession('technicien');
    installerParc([]);
    rendre();

    expect(await screen.findByText('Aucun véhicule de courtoisie')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Prêter' })).not.toBeInTheDocument();
  });

  it('un chef d’atelier peut ajouter une voiture au parc', async () => {
    installerSession('chef_atelier');
    installerParc([LIBRE]);
    rendre();

    expect(await screen.findByRole('button', { name: 'Ajouter une voiture' })).toBeInTheDocument();
  });
});
