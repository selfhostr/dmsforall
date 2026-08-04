import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { PageCurseur, ReponsePointage } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranJournalPointage } from './EcranJournalPointage';

function pagePointages(donnees: readonly ReponsePointage[]): PageCurseur<ReponsePointage> {
  return { donnees, curseurSuivant: null, limite: 50 };
}

function construirePointage(overrides: Partial<ReponsePointage> = {}): ReponsePointage {
  return {
    id: 'pointage-1',
    siteId: 'site-1',
    technicienId: 'tech-1',
    technicienNomAffiche: 'Isabelle Bonvin',
    statut: 'termine',
    nature: 'productif_ligne',
    ordreReparationId: 'or-1',
    ligneOrId: 'ligne-1',
    activiteIndirecte: null,
    source: 'ecran_atelier',
    appareilId: null,
    debutLe: '2026-08-03T07:00:00.000Z',
    finLe: '2026-08-03T09:00:00.000Z',
    dureeBruteSecondes: 7200,
    dureeArrondieCentiemes: 200,
    clotureAutomatique: false,
    anomalie: null,
    derniereCorrection: null,
    creeLe: '2026-08-03T07:00:00.000Z',
    modifieLe: '2026-08-03T09:00:00.000Z',
    ...overrides,
  };
}

function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pointage/jour']}>
        <Routes>
          <Route path="/pointage/jour" element={<EcranJournalPointage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranJournalPointage', () => {
  it('affiche le cumul par technicien et le total', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([construirePointage()]))),
    );

    rendre();

    // « 2 h 00 » apparaît QUATRE fois (productif + présence de la ligne technicien, productif +
    // présence de la ligne total — un seul pointage productif de 2 h dans le lot, donc productif
    // == présence des deux côtés) : on compte les occurrences plutôt que de chercher un texte unique.
    expect((await screen.findAllByText('2 h 00')).length).toBe(4);
    expect(screen.getByText('Total')).toBeInTheDocument();
    // Régression défaut 1 : le nom du technicien vient de `technicienNomAffiche`, jamais d'un
    // repli sur l'UUID tronqué (`technicienId.slice(0, 8)`).
    expect(screen.getByText('Isabelle Bonvin')).toBeInTheDocument();
    expect(screen.queryByText(/^Technicien [0-9a-f-]+$/)).not.toBeInTheDocument();
  });

  it('état vide : aucun pointage sur la période', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([]))),
    );

    rendre();

    expect(
      await screen.findByText('Aucun pointage enregistré sur cette période.'),
    ).toBeInTheDocument();
  });

  it('affiche une erreur actionnable si le serveur échoue', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/pointages', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur interne',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: '',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    rendre();

    expect(await screen.findByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });
});
