import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranCloturePeriodePointage } from './EcranCloturePeriodePointage';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

function rendre() {
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/pointage/cloture']}>
        <Routes>
          <Route path="/pointage/cloture" element={<EcranCloturePeriodePointage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranCloturePeriodePointage', () => {
  it('verrouille une période et affiche le nombre de pointages verrouillés', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.post('/api/v1/pointages/verrouiller-periode', () =>
        HttpResponse.json({ siteId: 'site-1', jusquauLe: '2026-08-01', pointagesVerrouilles: 12 }),
      ),
    );

    rendre();

    const utilisateur = userEvent.setup();
    await utilisateur.click(await screen.findByRole('button', { name: 'Verrouiller' }));

    expect(await screen.findByText('12 pointages verrouillés.')).toBeInTheDocument();
  });

  it("affiche une erreur actionnable si le verrouillage échoue (pointage encore en cours)", async () => {
    server.use(
      http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)),
      http.post('/api/v1/pointages/verrouiller-periode', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/CONFLIT',
            title: 'Conflit',
            status: 409,
            code: 'CONFLIT',
            instance: '',
          },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    rendre();

    const utilisateur = userEvent.setup();
    await utilisateur.click(await screen.findByRole('button', { name: 'Verrouiller' }));

    expect(await screen.findByText('Cet élément a été modifié entre-temps. Rechargez la page.')).toBeInTheDocument();
  });

  it('exige un motif pour déverrouiller une période', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));

    rendre();

    const utilisateur = userEvent.setup();
    await utilisateur.click(await screen.findByRole('button', { name: 'Déverrouiller' }));

    expect(await screen.findByText('Le motif est obligatoire pour déverrouiller une période.')).toBeInTheDocument();
  });

  it('site requis : invite à choisir un site quand plusieurs sont actifs', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json({
          ...SESSION_TEST,
          sites: [
            { id: 'site-1', code: 'P', nom: 'Site principal', actif: true },
            { id: 'site-2', code: 'S', nom: 'Site secondaire', actif: true },
          ],
        }),
      ),
    );

    rendre();

    expect(await screen.findByText('Choisissez un site')).toBeInTheDocument();
  });
});
