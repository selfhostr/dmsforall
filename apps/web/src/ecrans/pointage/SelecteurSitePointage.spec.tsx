import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { SessionCourante } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { SelecteurSitePointage } from './SelecteurSitePointage';

// Radix Select (`@radix-ui/react-select`) appelle `hasPointerCapture`/`scrollIntoView`, absents
// de jsdom — même stub que `composants/comptoir/SelecteurTri.spec.tsx`.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const SESSION_DEUX_SITES: SessionCourante = {
  ...SESSION_TEST,
  sites: [
    { id: 'site-1', code: 'MARTIGNY', nom: 'Garage Martin — Martigny', actif: true },
    { id: 'site-2', code: 'SION', nom: 'Garage Martin — Sion', actif: true },
  ],
};

function rendre() {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <SelecteurSitePointage onChoisir={vi.fn()} />
    </QueryClientProvider>,
  );
}

/**
 * Même bug, même cause que `ecrans/pieces/SelecteurSiteRequis.spec.tsx` : `useSession()` en vol
 * au montage de ce composant ne doit jamais rendre un sélecteur silencieusement vide (`sites=[]`
 * indiscernable d'un tenant sans site actif).
 */
describe('SelecteurSitePointage', () => {
  it('affiche un état de chargement explicite tant que la session est en vol, jamais un sélecteur silencieusement vide', () => {
    server.use(
      http.get('/api/v1/auth/moi', async () => {
        await delay('infinite');
        return HttpResponse.json(null);
      }),
    );

    rendre();

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText('Choisissez un site')).not.toBeInTheDocument();
  });

  it('affiche un état d’erreur actionnable si la session ne peut pas être vérifiée', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.error()));

    rendre();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /réessayer/i })).toBeInTheDocument();
  });

  it('affiche les sites actifs dès que la session est résolue', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_DEUX_SITES)));

    rendre();

    const declencheur = await screen.findByRole('combobox');
    await userEvent.click(declencheur);

    expect(await screen.findByText('Garage Martin — Martigny')).toBeInTheDocument();
    expect(screen.getByText('Garage Martin — Sion')).toBeInTheDocument();
  });
});
