import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import type { ReponseDossierReprise, ReponsePlanReprise } from '@dfa/shared';

import '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EtapeValidationPlan } from './EtapeValidationPlan';

function dossier(): ReponseDossierReprise {
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
  };
}

function plan(): ReponsePlanReprise {
  return {
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
      {
        id: 'elt-vehicules',
        domaine: 'vehicules',
        tableDetecteeId: 'table-2',
        perimetre: 'detail_24_mois_glissants_et_ouverts',
        volumeAttenduLignes: 80,
        inclus: true,
        ajustable: true,
      },
    ],
    exclusions: [{ tableDetecteeId: 'table-3', motif: 'referentiel_constructeur_jamais_repris' }],
    proposeLe: '2026-08-24T08:00:00.000Z',
    valideLe: null,
    valideParUtilisateurId: null,
  };
}

function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <EtapeValidationPlan dossier={dossier()} />
    </QueryClientProvider>,
  );
}

describe('EtapeValidationPlan', () => {
  it('affiche le vocabulaire métier du plan, jamais un nom de table technique', async () => {
    server.use(
      http.get('/api/v1/reprise/dossiers/dossier-1/plan', () => HttpResponse.json(plan())),
    );
    rendre();

    await waitFor(() => expect(screen.getByText('Vos clients')).toBeInTheDocument());
    expect(screen.getByText('Vos véhicules')).toBeInTheDocument();
    expect(screen.queryByText(/table-1|table_clients|nomTechnique/i)).not.toBeInTheDocument();
  });

  it('décocher un domaine envoie exactement cet ajustement à PATCH .../plan — LE seul levier', async () => {
    server.use(
      http.get('/api/v1/reprise/dossiers/dossier-1/plan', () => HttpResponse.json(plan())),
    );
    let corpsRecu: unknown;
    server.use(
      http.patch('/api/v1/reprise/dossiers/dossier-1/plan', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json({
          ...plan(),
          elements: [{ ...plan().elements[0]!, inclus: false }, plan().elements[1]!],
        });
      }),
    );
    rendre();

    const utilisateur = userEvent.setup();
    const caseClients = await screen.findByRole('checkbox', { name: /reprendre vos clients/i });
    expect(caseClients).toBeChecked();

    await utilisateur.click(caseClients);

    await waitFor(() =>
      expect(corpsRecu).toEqual({ ajustements: [{ elementId: 'elt-clients', inclus: false }] }),
    );
  });

  it('bouton unique « Lancer l’import » — aucun éditeur de correspondance de champs', async () => {
    server.use(
      http.get('/api/v1/reprise/dossiers/dossier-1/plan', () => HttpResponse.json(plan())),
    );
    rendre();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /lancer l.import/i })).toBeInTheDocument(),
    );
    // Aucun contrôle de correspondance de champ (mapping) : ni menu déroulant de colonne, ni
    // champ de saisie de correspondance — seules des cases à cocher par domaine.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('affiche le motif d’exclusion dans le vocabulaire garagiste', async () => {
    server.use(
      http.get('/api/v1/reprise/dossiers/dossier-1/plan', () => HttpResponse.json(plan())),
    );
    rendre();

    await waitFor(() =>
      expect(
        screen.getByText(/jamais reprises, quel que soit le logiciel d.origine/i),
      ).toBeInTheDocument(),
    );
  });
});
