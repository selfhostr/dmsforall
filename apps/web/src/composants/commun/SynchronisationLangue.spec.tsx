import { QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import i18n, { chargerLangues } from '@/i18n';
import { server } from '@/test/msw/server';
import { SESSION_TEST } from '@/test/msw/handlers';
import { creerQueryClientTest } from '@/test/utils';

import { SynchronisationLangue } from './SynchronisationLangue';

function monter(session: object | null) {
  server.use(
    http.get('/api/v1/auth/moi', () =>
      session
        ? HttpResponse.json(session)
        : HttpResponse.json(
            { type: 'x', title: 'x', status: 401, code: 'AUTH_SESSION_ABSENTE', instance: 'r' },
            { status: 401, headers: { 'content-type': 'application/problem+json' } },
          ),
    ),
  );
  render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <SynchronisationLangue />
    </QueryClientProvider>,
  );
}

describe('SynchronisationLangue -- priorité profil / poste (issue #62)', () => {
  beforeEach(async () => {
    await chargerLangues();
    window.localStorage.clear();
    await i18n.changeLanguage('fr');
  });

  it('connecté : la langue du profil gagne sur la langue gardée sur le poste', async () => {
    window.localStorage.setItem('dfa.langue', 'it');
    monter({ ...SESSION_TEST, utilisateur: { ...SESSION_TEST.utilisateur, langue: 'de' } });
    await waitFor(() => expect(i18n.language).toBe('de'));
  });

  it('déconnecté : retombe sur la langue de l’écran de connexion du poste', async () => {
    window.localStorage.setItem('dfa.langue', 'it');
    monter(null);
    await waitFor(() => expect(i18n.language).toBe('it'));
  });
});
