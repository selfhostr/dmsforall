import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { PageDossierReprise, ReponseDossierReprise } from '@dfa/shared';

import '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { determinerEtapeAffichee, EcranReprise } from './EcranReprise';

function pageDossiers(donnees: readonly ReponseDossierReprise[]): PageDossierReprise {
  return { donnees, curseurSuivant: null, limite: 1 };
}

function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/reprise-donnees']}>
        <Routes>
          <Route path="/reprise-donnees" element={<EcranReprise />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function dossier(partiel: Partial<ReponseDossierReprise> = {}): ReponseDossierReprise {
  return {
    id: 'dossier-1',
    statut: 'plan_propose',
    archive: {
      tailleOctetsAnnoncee: 1000,
      octetsRecus: 1000,
      dernierNumeroTrancheRecuContigu: 0,
      empreinteSha256Annoncee: 'a'.repeat(64),
      empreinteSha256Verifiee: 'a'.repeat(64),
      integriteValidee: true,
    },
    analyseId: 'analyse-1',
    planId: 'plan-1',
    importId: null,
    creeLe: '2026-08-24T08:00:00.000Z',
    modifieLe: '2026-08-24T08:00:00.000Z',
    ...partiel,
  };
}

describe('determinerEtapeAffichee', () => {
  it('aucun dossier -> Dépôt', () => {
    expect(determinerEtapeAffichee(null)).toBe('depot');
  });

  it.each([
    ['depot_en_cours', 'depot'],
    ['depot_receptionne', 'analyse'],
    ['analyse_en_cours', 'analyse'],
    ['analyse_echouee', 'analyse'],
    ['analyse_terminee', 'analyse'],
    ['plan_propose', 'validation'],
    ['plan_valide', 'validation'],
    ['import_en_cours', 'import'],
    ['import_termine', 'import'],
    ['import_echoue', 'import'],
    ['annule', 'annule'],
  ] as const)('statut %s -> étape %s', (statut, etapeAttendue) => {
    expect(determinerEtapeAffichee(dossier({ statut }))).toBe(etapeAttendue);
  });
});

describe('EcranReprise', () => {
  it('état de chargement : squelette affiché pendant la requête', () => {
    server.use(http.get('/api/v1/reprise/dossiers', () => new Promise(() => {})));
    rendre();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/chargement/i)).toBeInTheDocument();
  });

  it('état vide (aucun dossier) : affiche l’étape Dépôt, jamais un écran blanc', async () => {
    server.use(http.get('/api/v1/reprise/dossiers', () => HttpResponse.json(pageDossiers([]))));
    rendre();
    await waitFor(() => expect(screen.getByText(/glissez votre fichier ici/i)).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: /reprise de données/i })).toBeInTheDocument();
  });

  it('état d’erreur : message actionnable avec retry', async () => {
    server.use(http.get('/api/v1/reprise/dossiers', () => HttpResponse.json({}, { status: 500 })));
    rendre();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /réessayer/i })).toBeInTheDocument(),
    );
  });

  it('dossier plan_propose : affiche l’étape Validation avec les domaines du plan', async () => {
    server.use(
      http.get('/api/v1/reprise/dossiers', () => HttpResponse.json(pageDossiers([dossier()]))),
      http.get('/api/v1/reprise/dossiers/dossier-1/plan', () =>
        HttpResponse.json({
          id: 'plan-1',
          dossierRepriseId: 'dossier-1',
          analyseId: 'analyse-1',
          statut: 'propose',
          elements: [
            {
              id: 'elt-clients',
              domaine: 'clients',
              tableDetecteeId: 'table-1',
              perimetre: 'detail_24_mois_glissants_et_ouverts',
              volumeAttenduLignes: 120,
              inclus: true,
              ajustable: true,
            },
          ],
          exclusions: [],
          proposeLe: '2026-08-24T08:00:00.000Z',
          valideLe: null,
          valideParUtilisateurId: null,
        }),
      ),
    );
    rendre();
    await waitFor(() => expect(screen.getByText(/vos clients/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /lancer l.import/i })).toBeInTheDocument();
  });

  it('dossier annulé : offre de déposer une nouvelle archive, revient à l’étape Dépôt', async () => {
    server.use(
      http.get('/api/v1/reprise/dossiers', () =>
        HttpResponse.json(pageDossiers([dossier({ statut: 'annule' })])),
      ),
    );
    rendre();
    await waitFor(() => expect(screen.getByText(/reprise annulée/i)).toBeInTheDocument());

    const utilisateur = userEvent.setup();
    await utilisateur.click(screen.getByRole('button', { name: /déposer une nouvelle archive/i }));

    await waitFor(() => expect(screen.getByText(/glissez votre fichier ici/i)).toBeInTheDocument());
  });
});
