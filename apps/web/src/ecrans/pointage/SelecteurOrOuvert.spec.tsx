import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import type { ClientResume, OrdreReparationResume, PageCurseur, VehiculeResume } from '@dfa/shared';

import '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { SelecteurOrOuvert } from './SelecteurOrOuvert';

const VEHICULE_TEST: VehiculeResume = {
  id: 'veh-1',
  plaque: '445566',
  canton: 'VD',
  designation: 'VW Touran 2.0 TDI',
  vin: null,
  premiereMiseEnCirculationLe: null,
  identificationIncomplete: false,
  emplacementLibre: null,
};

const CLIENT_TEST: ClientResume = {
  id: 'cl-1',
  numeroClient: 'CL-000123',
  nomAffiche: 'Jean Dupont',
  type: 'particulier',
  statut: 'actif',
  langueCorrespondance: 'fr',
  poObligatoire: false,
  telephone: null,
  localite: 'Lausanne',
  nombreVehicules: 1,
  dernierPassageLe: null,
};

function construireOr(overrides: Partial<OrdreReparationResume> = {}): OrdreReparationResume {
  return {
    id: 'or-1',
    numero: 'OR-2026-4',
    statut: 'ouvert',
    etatAffiche: 'ouvert',
    type: 'reparation',
    localisation: 'atelier',
    ouvertLe: '2026-08-14T06:00:00.000Z',
    restitutionPromiseLe: null,
    vehicule: VEHICULE_TEST,
    client: CLIENT_TEST,
    nombreLignes: 1,
    ...overrides,
  };
}

function pageOrdres(donnees: readonly OrdreReparationResume[]): PageCurseur<OrdreReparationResume> {
  return { donnees, curseurSuivant: null, limite: 50 };
}

function rendre() {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <SelecteurOrOuvert siteId={undefined} onChoisirOr={vi.fn()} />
    </QueryClientProvider>,
  );
}

/**
 * Test manuel du 14.08.2026 (défaut 3) : la requête filtrait `statut=ouvert` en dur, rendant
 * introuvable une OR `en_cours` — précisément la cible la plus probable d'un technicien qui cherche
 * à pointer. Ce fichier prouve que la requête envoyée n'impose plus AUCUN `statut` (voir
 * `SelecteurOrOuvert.tsx`, § « AUCUN filtre `statut` sur la requête »), et que le tri restant côté
 * client (`statutOrPointable`) couvre bien tous les statuts pointables (RM-92) sans réintroduire un
 * OR non pointable (`termine`).
 */
describe('SelecteurOrOuvert', () => {
  it('n’envoie aucun filtre `statut` — la liste couvre tous les statuts pointables, pas seulement `ouvert`', async () => {
    let statutRecu: string | null | undefined;
    server.use(
      http.get('/api/v1/ordres-reparation', ({ request }) => {
        statutRecu = new URL(request.url).searchParams.get('statut');
        return HttpResponse.json(pageOrdres([construireOr({ id: 'or-4', numero: 'OR-2026-4' })]));
      }),
    );

    rendre();

    await screen.findByText('OR-2026-4');
    expect(statutRecu).toBeNull();
  });

  it('affiche une OR « en_cours » — introuvable avant le correctif —, jamais une OR non pointable comme « termine »', async () => {
    server.use(
      http.get('/api/v1/ordres-reparation', () =>
        HttpResponse.json(
          pageOrdres([
            construireOr({ id: 'or-10', numero: 'OR-2026-10', statut: 'en_cours' }),
            construireOr({ id: 'or-11', numero: 'OR-2026-11', statut: 'termine' }),
          ]),
        ),
      ),
    );

    rendre();

    expect(await screen.findByText('OR-2026-10')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('OR-2026-11')).not.toBeInTheDocument());
  });

  it('affiche l’état vide quand seuls des OR non pointables sont rendus par le serveur', async () => {
    server.use(
      http.get('/api/v1/ordres-reparation', () =>
        HttpResponse.json(pageOrdres([construireOr({ id: 'or-12', statut: 'facture' })])),
      ),
    );

    rendre();

    expect(
      await screen.findByText('Aucune OR ouverte ne correspond à cette recherche.'),
    ).toBeInTheDocument();
  });
});
