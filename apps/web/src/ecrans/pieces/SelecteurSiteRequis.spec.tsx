import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { SessionCourante } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { SelecteurSiteRequis } from './SelecteurSiteRequis';

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
    { id: 'site-1', code: 'PRINCIPAL', codeCourt: 'PRINC', nom: 'Site principal', actif: true },
    { id: 'site-2', code: 'SECONDAIRE', codeCourt: 'SECON', nom: 'Site secondaire', actif: true },
  ],
};

function rendre() {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <SelecteurSiteRequis onChoisir={vi.fn()} />
    </QueryClientProvider>,
  );
}

/**
 * Reproduit le bug confirmé au navigateur (« sélecteur de site vide/invisible au premier
 * chargement, ~1 fois sur 2 ») : `useSession()` n'est pas garanti résolu au montage de CE
 * composant précis (`RouteProtegee` ne bloque que sur la toute première requête de session de
 * l'arbre). Avant le correctif, `session?.sites ?? []` retombait silencieusement sur `[]` pendant
 * `isPending`, rendant un `EtatVide` SANS action (aucune option, aucun indice de chargement) —
 * indiscernable en apparence d'un tenant sans site actif.
 */
describe('SelecteurSiteRequis', () => {
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
    // Le titre de l'état vide « normal » (session résolue, aucun site) ne doit PAS apparaître
    // pendant le chargement : ce serait la preuve que le composant a confondu "en vol" et "vide".
    expect(screen.queryByText('Choisissez un site')).not.toBeInTheDocument();
  });

  it('affiche un état d’erreur actionnable si la session ne peut pas être vérifiée', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.error()));

    rendre();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /réessayer/i })).toBeInTheDocument();
  });

  it('affiche les sites actifs dès que la session est résolue, sans présélection incohérente', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_DEUX_SITES)));

    rendre();

    const declencheur = await screen.findByRole('combobox');
    await userEvent.click(declencheur);

    expect(await screen.findByText('Site principal')).toBeInTheDocument();
    expect(screen.getByText('Site secondaire')).toBeInTheDocument();
  });

  it('ne liste que les sites ACTIFS de la session', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json({
          ...SESSION_TEST,
          sites: [
            {
              id: 'site-1',
              code: 'PRINCIPAL',
              codeCourt: 'PRINC',
              nom: 'Site principal',
              actif: true,
            },
            {
              id: 'site-2',
              code: 'SECONDAIRE',
              codeCourt: 'SECON',
              nom: 'Site secondaire',
              actif: true,
            },
            { id: 'site-3', code: 'FERME', codeCourt: 'FERME', nom: 'Site fermé', actif: false },
          ],
        }),
      ),
    );

    rendre();

    const declencheur = await screen.findByRole('combobox');
    await userEvent.click(declencheur);

    expect(await screen.findByText('Site principal')).toBeInTheDocument();
    expect(screen.queryByText('Site fermé')).not.toBeInTheDocument();
  });

  it('garage mono-site : choisit le site d’office, sans poser de question', async () => {
    server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
    const onChoisir = vi.fn();
    render(
      <QueryClientProvider client={creerQueryClientTest()}>
        <SelecteurSiteRequis onChoisir={onChoisir} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(onChoisir).toHaveBeenCalledWith('site-1'));
    expect(onChoisir).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
