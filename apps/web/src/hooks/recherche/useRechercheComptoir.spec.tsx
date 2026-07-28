import type { ReponseRecherche } from '@dfa/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { useRechercheComptoir } from './useRechercheComptoir';

const REPONSE_TEST: ReponseRecherche = {
  plaqueInterchangeable: false,
  resultats: [
    {
      type: 'vehicule',
      id: 'v1',
      score: 0.9,
      correspondance: { champ: 'plaque', valeur: 'VD 123456', historique: false },
      resume: { plaque: 'VD 123456', designation: 'VW Touran 2.0 TDI' },
    },
  ],
};

function enveloppe() {
  const queryClient = creerQueryClientTest();
  return function Enveloppe({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useRechercheComptoir', () => {
  it('ne cherche rien tant que rien n’est saisi : reponse null, jamais en chargement', () => {
    const { result } = renderHook(() => useRechercheComptoir(), { wrapper: enveloppe() });

    expect(result.current.saisie).toBe('');
    expect(result.current.reponse).toBeNull();
    expect(result.current.enChargement).toBe(false);
    expect(result.current.enErreur).toBe(false);
  });

  it('passe en chargement dès la frappe (anti-rebond), puis livre la réponse une fois stabilisée', async () => {
    let requetesRecues = 0;
    server.use(
      http.get('/api/v1/recherche', ({ request }) => {
        requetesRecues += 1;
        const url = new URL(request.url);
        expect(url.searchParams.get('q')).toBe('VD 123456');
        return HttpResponse.json(REPONSE_TEST);
      }),
    );

    const { result } = renderHook(() => useRechercheComptoir(), { wrapper: enveloppe() });

    act(() => result.current.onSaisieChange('VD 123456'));

    // Anti-rebond pas encore écoulé : déjà "en chargement", saisie jamais perdue.
    expect(result.current.saisie).toBe('VD 123456');
    expect(result.current.enChargement).toBe(true);

    await waitFor(() => expect(result.current.enChargement).toBe(false), { timeout: 2000 });

    expect(result.current.reponse).toEqual(REPONSE_TEST);
    expect(result.current.enErreur).toBe(false);
    // Une seule requête envoyée malgré l'anti-rebond : pas de frappe intermédiaire ici, mais
    // vérifie qu'aucun appel prématuré n'a été fait avant stabilisation.
    expect(requetesRecues).toBe(1);
  });

  it('revient à l’état "rien saisi" (reponse null) quand la saisie est effacée', async () => {
    server.use(http.get('/api/v1/recherche', () => HttpResponse.json(REPONSE_TEST)));
    const { result } = renderHook(() => useRechercheComptoir(), { wrapper: enveloppe() });

    act(() => result.current.onSaisieChange('VD 123456'));
    await waitFor(() => expect(result.current.reponse).toEqual(REPONSE_TEST));

    act(() => result.current.onSaisieChange(''));
    expect(result.current.reponse).toBeNull();
    expect(result.current.enChargement).toBe(false);
  });

  it('erreur serveur : enErreur devient vrai avec l’erreur exploitable, et relancer() rejoue la requête', async () => {
    let premierAppel = true;
    server.use(
      http.get('/api/v1/recherche', () => {
        if (premierAppel) {
          premierAppel = false;
          return HttpResponse.json(
            {
              type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
              title: 'Erreur interne',
              status: 500,
              code: 'ERREUR_INTERNE',
              instance: 'req-1',
            },
            { status: 500, headers: { 'content-type': 'application/problem+json' } },
          );
        }
        return HttpResponse.json(REPONSE_TEST);
      }),
    );

    const { result } = renderHook(() => useRechercheComptoir(), { wrapper: enveloppe() });
    act(() => result.current.onSaisieChange('VD 123456'));

    await waitFor(() => expect(result.current.enErreur).toBe(true), { timeout: 2000 });
    expect(result.current.erreur).toBeInstanceOf(Error);

    act(() => result.current.relancer());

    await waitFor(() => expect(result.current.enErreur).toBe(false), { timeout: 2000 });
    expect(result.current.reponse).toEqual(REPONSE_TEST);
  });
});
