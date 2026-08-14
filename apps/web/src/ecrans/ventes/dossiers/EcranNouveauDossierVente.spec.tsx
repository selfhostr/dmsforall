import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { ReponseClient, ReponseDossierVente } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranNouveauDossierVente } from './EcranNouveauDossierVente';

const CLIENT: ReponseClient = {
  id: 'client-1',
  numeroClient: 'CL-0001',
  nomAffiche: 'Jean Dupont',
  type: 'particulier',
  statut: 'actif',
  langueCorrespondance: 'fr',
  poObligatoire: false,
  telephone: null,
  email: null,
  notesAlerte: [],
  fusionneVersClientId: null,
  dernierPassageLe: null,
  creeLe: '2026-01-01T08:00:00.000Z',
  modifieLe: '2026-01-01T08:00:00.000Z',
  version: 1,
} as unknown as ReponseClient;

function rendre(route: string) {
  server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path="/ventes/dossiers/nouveau" element={<EcranNouveauDossierVente />} />
          <Route path="/ventes/dossiers/:id" element={<div>Fiche du dossier créé</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranNouveauDossierVente', () => {
  it('état vide : aucun site sélectionné bloque la création', async () => {
    rendre('/ventes/dossiers/nouveau');

    expect(await screen.findByText('Aucun site sélectionné')).toBeInTheDocument();
  });

  it('avec un client pré-rempli, la recherche véhicule sans résultat affiche un état vide', async () => {
    server.use(http.get('/api/v1/clients/client-1', () => HttpResponse.json(CLIENT)));
    server.use(
      http.get('/api/v1/vehicules-stock', () =>
        HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 20 }),
      ),
    );

    rendre('/ventes/dossiers/nouveau?site=site-1&clientId=client-1');
    const utilisateur = userEvent.setup();

    expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();

    await utilisateur.type(screen.getByPlaceholderText('Plaque, VIN ou désignation…'), 'ZZ999999');

    expect(
      await screen.findByText('Aucun véhicule en stock ne correspond à cette recherche.'),
    ).toBeInTheDocument();
  });

  it('crée le dossier et navigue vers sa fiche', async () => {
    server.use(http.get('/api/v1/clients/client-1', () => HttpResponse.json(CLIENT)));
    let corpsRecu: unknown;
    const dossierCree: ReponseDossierVente = {
      id: 'dossier-nouveau',
      siteId: 'site-1',
      statut: 'prospection',
      typeVehicule: null,
      vehicule: null,
      clientAcheteur: {
        id: 'client-1',
        numeroClient: 'CL-0001',
        nomAffiche: 'Jean Dupont',
        type: 'particulier',
        statut: 'actif',
        langueCorrespondance: 'fr',
        poObligatoire: false,
        telephone: null,
        localite: null,
        nombreVehicules: 0,
        dernierPassageLe: null,
      },
      clientFacture: {
        id: 'client-1',
        numeroClient: 'CL-0001',
        nomAffiche: 'Jean Dupont',
        type: 'particulier',
        statut: 'actif',
        langueCorrespondance: 'fr',
        poObligatoire: false,
        telephone: null,
        localite: null,
        nombreVehicules: 0,
        dernierPassageLe: null,
      },
      clientConducteur: null,
      reprise: null,
      financement: null,
      financements: [],
      financementsTronques: false,
      garantie: null,
      documents: [],
      documentsTronques: false,
      documentsRequis: [],
      identitePieceType: null,
      identiteVerifieeLe: null,
      dateLivraisonEstimee: null,
      dateLivraisonEffective: null,
      kilometrageDepart: null,
      prospectionLe: '2026-08-01T08:00:00.000Z',
      engageLe: null,
      enPreparationLe: null,
      pretALivrerLe: null,
      livreLe: null,
      closLe: null,
      annuleLe: null,
      abandonneLe: null,
      motifCloture: null,
      actionsDisponibles: ['modifier', 'engager', 'annuler', 'abandonner'],
      version: 1,
      creeLe: '2026-08-01T08:00:00.000Z',
      modifieLe: '2026-08-01T08:00:00.000Z',
      modifiePar: null,
    };
    server.use(
      http.post('/api/v1/dossiers-vente', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json({ donnees: dossierCree, avertissements: [] }, { status: 201 });
      }),
    );

    rendre('/ventes/dossiers/nouveau?site=site-1&clientId=client-1');
    const utilisateur = userEvent.setup();

    expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();
    await utilisateur.click(screen.getByRole('button', { name: 'Créer le dossier' }));

    expect(await screen.findByText('Fiche du dossier créé')).toBeInTheDocument();
    await waitFor(() =>
      expect(corpsRecu).toMatchObject({ siteId: 'site-1', clientAcheteurId: 'client-1' }),
    );
  });
});
