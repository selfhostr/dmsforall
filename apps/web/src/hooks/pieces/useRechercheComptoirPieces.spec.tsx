import type { ResultatRechercheComptoirArticle } from '@dfa/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { useRechercheComptoirPieces } from './useRechercheComptoirPieces';

const RESULTATS_TEST: readonly ResultatRechercheComptoirArticle[] = [
  {
    articleId: 'art-1',
    numeroArticle: 'P-000123',
    designation: 'Plaquettes de frein avant',
    referencePrincipale: '1K0698151',
    prixVenteTtcCentimes: 8900,
    quantiteDisponibleMillieme: 3000,
    emplacement: 'B3',
    estEchangeStandard: false,
    montantConsigneTtcCentimes: null,
  },
];

function enveloppe() {
  const queryClient = creerQueryClientTest();
  return function Enveloppe({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useRechercheComptoirPieces', () => {
  it('ne cherche rien sans site sélectionné, même si une saisie existe', () => {
    const { result } = renderHook(() => useRechercheComptoirPieces(undefined), {
      wrapper: enveloppe(),
    });

    act(() => result.current.onSaisieChange('1K0698151'));

    expect(result.current.resultats).toBeNull();
    expect(result.current.enChargement).toBe(false);
  });

  it('interroge /articles/recherche-comptoir avec q et siteId une fois la frappe stabilisée', async () => {
    let requeteRecue: URLSearchParams | undefined;
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', ({ request }) => {
        requeteRecue = new URL(request.url).searchParams;
        return HttpResponse.json(RESULTATS_TEST);
      }),
    );

    const { result } = renderHook(() => useRechercheComptoirPieces('site-1'), {
      wrapper: enveloppe(),
    });

    act(() => result.current.onSaisieChange('1K0698151'));
    expect(result.current.enChargement).toBe(true);

    await waitFor(() => expect(result.current.enChargement).toBe(false), { timeout: 2000 });

    expect(result.current.resultats).toEqual(RESULTATS_TEST);
    expect(requeteRecue?.get('q')).toBe('1K0698151');
    expect(requeteRecue?.get('siteId')).toBe('site-1');
  });

  it('revient à `null` (jamais "aucun résultat") quand la saisie est effacée', async () => {
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', () => HttpResponse.json(RESULTATS_TEST)),
    );
    const { result } = renderHook(() => useRechercheComptoirPieces('site-1'), {
      wrapper: enveloppe(),
    });

    act(() => result.current.onSaisieChange('1K0698151'));
    await waitFor(() => expect(result.current.resultats).toEqual(RESULTATS_TEST));

    act(() => result.current.onSaisieChange(''));
    expect(result.current.resultats).toBeNull();
  });

  it('aucun résultat pour une référence inexistante : réponse `[]`, jamais une erreur', async () => {
    server.use(http.get('/api/v1/articles/recherche-comptoir', () => HttpResponse.json([])));
    const { result } = renderHook(() => useRechercheComptoirPieces('site-1'), {
      wrapper: enveloppe(),
    });

    act(() => result.current.onSaisieChange('REFERENCE-INTROUVABLE'));
    await waitFor(() => expect(result.current.enChargement).toBe(false), { timeout: 2000 });

    expect(result.current.resultats).toEqual([]);
    expect(result.current.enErreur).toBe(false);
  });
});
