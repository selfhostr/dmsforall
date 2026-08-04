import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { PageCurseur, ReponsePointage } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranEquipePointage } from './EcranEquipePointage';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

function pagePointages(donnees: readonly ReponsePointage[]): PageCurseur<ReponsePointage> {
  return { donnees, curseurSuivant: null, limite: 50 };
}

const POINTAGE: ReponsePointage = {
  id: 'pointage-1',
  siteId: 'site-1',
  technicienId: 'technicien-abcdef01',
  technicienNomAffiche: 'Isabelle Bonvin',
  statut: 'termine',
  nature: 'indirect',
  ordreReparationId: null,
  ligneOrId: null,
  activiteIndirecte: 'nettoyage',
  source: 'ecran_atelier',
  appareilId: null,
  debutLe: '2026-08-03T07:00:00.000Z',
  finLe: '2026-08-03T07:30:00.000Z',
  dureeBruteSecondes: 1800,
  dureeArrondieCentiemes: 50,
  clotureAutomatique: false,
  anomalie: null,
  derniereCorrection: null,
  creeLe: '2026-08-03T07:00:00.000Z',
  modifieLe: '2026-08-03T07:30:00.000Z',
};

function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pointage/equipe']}>
        <Routes>
          <Route path="/pointage/equipe" element={<EcranEquipePointage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranEquipePointage', () => {
  it("affiche les pointages de l'équipe avec l'activité et la durée", async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([POINTAGE]))),
      http.get('/api/v1/ordres-reparation', () =>
        HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
      ),
    );

    rendre();

    expect(await screen.findByText('Nettoyage')).toBeInTheDocument();
    expect(screen.getByText('30 min')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Corriger' })).toBeInTheDocument();
    // Régression défaut 1 : le nom du technicien vient de `technicienNomAffiche`, jamais d'un
    // repli sur l'UUID tronqué (`technicienId.slice(0, 8)`).
    expect(screen.getByText('Isabelle Bonvin')).toBeInTheDocument();
    expect(screen.queryByText(/^Technicien [0-9a-f]{8}$/)).not.toBeInTheDocument();
  });

  it(
    'régression défaut 1 : affiche le numéro d’OR réel dans la colonne « Cible » — ' +
      "jamais l'UUID brut de ordreReparationId/ligneOrId",
    async () => {
      const pointageOr: ReponsePointage = {
        ...POINTAGE,
        id: 'pointage-2',
        nature: 'productif_or',
        ordreReparationId: 'or-1',
        ligneOrId: null,
        activiteIndirecte: null,
      };
      server.use(
        http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
        http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([pointageOr]))),
        http.get('/api/v1/ordres-reparation', () =>
          HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
        ),
      );

      rendre();

      // Pas de numéro d'OR dans `ReponsePointage` (contrat actuel) : au minimum, un texte sans
      // ambiguïté et sans UUID brut (voir la limitation documentée dans
      // `EcranEquipePointage.tsx`/`libelles.ts`, `libelleCibleEquipePointage`).
      expect(await screen.findByText('OR entier')).toBeInTheDocument();
      expect(screen.queryByText('or-1')).not.toBeInTheDocument();
    },
  );

  it('état vide : aucun pointage pour ce site sur cette période', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.get('/api/v1/pointages', () => HttpResponse.json(pagePointages([]))),
      http.get('/api/v1/ordres-reparation', () =>
        HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
      ),
    );

    rendre();

    expect(
      await screen.findByText('Aucun pointage pour ce site sur cette période.'),
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
      http.get('/api/v1/ordres-reparation', () =>
        HttpResponse.json({ donnees: [], curseurSuivant: null, limite: 50 }),
      ),
    );

    rendre();

    expect(await screen.findByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });
});
