import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { PageCurseur } from '@dfa/shared';

import { ErreurApi } from '@/api/erreurs';
import { creerQueryClientTest } from '@/test/utils';

import { useDoitReessayer, useListeCurseur } from './pagination-curseur';

function enveloppe() {
  const queryClient = creerQueryClientTest();
  return function Enveloppe({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

/** Enveloppe un `QueryClient` dont les défauts sont CHOISIS par le test — c'est précisément ce
 *  dont `useDoitReessayer` a besoin pour composer sa décision (voir l'en-tête de cette fonction,
 *  plus bas dans `pagination-curseur.ts`). */
function envelopperClient(queryClient: QueryClient) {
  return function EnveloppeClient({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function erreurApi(status: number): ErreurApi {
  return new ErreurApi({
    type: 'https://docs.dmsforall.example/erreurs/TEST',
    title: 'Erreur de test',
    status,
    code: status === 403 ? 'DROIT_INSUFFISANT' : 'RESSOURCE_INTROUVABLE',
    instance: 'req-test',
  });
}

function page(donnees: readonly string[], curseurSuivant: string | null): PageCurseur<string> {
  return { donnees: [...donnees], curseurSuivant, limite: 50 };
}

/**
 * `useListeCurseur` n'appelle pas le réseau lui-même : le chargeur lui est fourni par le hook de
 * domaine. Les tests l'exercent donc avec de simples fonctions espionnées — c'est exactement la
 * frontière que le patron définit, et cela rend chaque assertion sur « la requête est-elle
 * partie ? » directe plutôt que déduite d'un intercepteur HTTP.
 */
describe('useListeCurseur', () => {
  it('charge la première page SANS curseur et aplatit les pages', async () => {
    const charger = vi.fn(() => Promise.resolve(page(['a', 'b'], null)));

    const { result } = renderHook(() => useListeCurseur<string>({ cle: ['t', 1], charger }), {
      wrapper: enveloppe(),
    });

    await waitFor(() => expect(result.current.resultat.isSuccess).toBe(true));
    expect(charger).toHaveBeenCalledWith(undefined);
    expect(result.current.elements).toEqual(['a', 'b']);
    expect(result.current.resultat.hasNextPage).toBe(false);
  });

  it('enchaîne les pages en transmettant le curseur reçu, et concatène les éléments', async () => {
    const charger = vi.fn((curseur: string | undefined) =>
      Promise.resolve(curseur === undefined ? page(['a'], 'p2') : page(['b'], null)),
    );

    const { result } = renderHook(() => useListeCurseur<string>({ cle: ['t', 2], charger }), {
      wrapper: enveloppe(),
    });

    await waitFor(() => expect(result.current.resultat.isSuccess).toBe(true));
    expect(result.current.resultat.hasNextPage).toBe(true);

    await act(async () => {
      await result.current.resultat.fetchNextPage();
    });

    await waitFor(() => expect(result.current.elements).toEqual(['a', 'b']));
    expect(charger.mock.calls.map(([curseur]) => curseur)).toEqual([undefined, 'p2']);
    expect(result.current.resultat.hasNextPage).toBe(false);
  });

  // Le cœur de la factorisation : la garde ne peut pas être oubliée puisqu'elle EST l'absence de
  // chargeur. Un hook dont la dépendance n'est pas résolue ne peut pas produire de chargeur.
  it('chargeur absent : aucune requête, et une liste vide plutôt qu’un plantage', async () => {
    const { result } = renderHook(
      () => useListeCurseur<string>({ cle: ['t', 3], charger: undefined }),
      { wrapper: enveloppe() },
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.current.resultat.isPending).toBe(true);
    expect(result.current.resultat.fetchStatus).toBe('idle');
    expect(result.current.elements).toEqual([]);
  });

  it('actif: false désactive la requête même quand le chargeur existe', async () => {
    const charger = vi.fn(() => Promise.resolve(page(['a'], null)));

    const { result } = renderHook(
      () => useListeCurseur<string>({ cle: ['t', 4], charger, actif: false }),
      { wrapper: enveloppe() },
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(charger).not.toHaveBeenCalled();
    expect(result.current.resultat.isPending).toBe(true);
  });

  it('actif omis vaut `true` (comportement identique à l’absence d’option côté appelant)', async () => {
    const charger = vi.fn(() => Promise.resolve(page(['a'], null)));

    const { result } = renderHook(
      () => useListeCurseur<string>({ cle: ['t', 5], charger, actif: undefined }),
      { wrapper: enveloppe() },
    );

    await waitFor(() => expect(result.current.resultat.isSuccess).toBe(true));
    expect(charger).toHaveBeenCalledTimes(1);
  });

  /**
   * Régression : `QueryClient.defaultQueryOptions` fusionne par étalement, donc passer
   * `retry: undefined` ÉCRASERAIT le défaut du client au lieu de le laisser jouer. Le
   * `QueryClient` de test pose `retry: false` ; si `useListeCurseur` transmettait un `retry`
   * explicitement indéfini, le chargeur serait rappelé trois fois de plus. Ce test échouerait
   * alors sur le compteur, pas sur l'état final — d'où l'assertion sur le NOMBRE d'appels.
   */
  it('sans `reessayer`, le défaut de réessai du QueryClient reste en vigueur', async () => {
    const charger = vi.fn(() => Promise.reject(new Error('panne')));

    const { result } = renderHook(() => useListeCurseur<string>({ cle: ['t', 6], charger }), {
      wrapper: enveloppe(),
    });

    await waitFor(() => expect(result.current.resultat.isError).toBe(true));
    expect(charger).toHaveBeenCalledTimes(1);
  });

  it('`reessayer` fourni pilote la politique de réessai', async () => {
    const charger = vi.fn(() => Promise.reject(new Error('panne')));

    const { result } = renderHook(
      () =>
        useListeCurseur<string>({
          cle: ['t', 7],
          charger,
          reessayer: (nombreEchecs) => nombreEchecs < 2,
        }),
      { wrapper: enveloppe() },
    );

    await waitFor(() => expect(result.current.resultat.isError).toBe(true), { timeout: 5000 });
    expect(charger).toHaveBeenCalledTimes(3);
  });
});

describe('useDoitReessayer', () => {
  describe('refus stable (403/404) : dévie du défaut du client, TOUJOURS', () => {
    it('refuse tout réessai sur un 403, même si le client par défaut réessaierait indéfiniment', () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: true } } });
      const { result } = renderHook(() => useDoitReessayer(), {
        wrapper: envelopperClient(queryClient),
      });

      expect(result.current(0, erreurApi(403))).toBe(false);
      // Même refus quel que soit le nombre d'échecs déjà comptés — un 403 ne devient jamais
      // transitoire avec le temps.
      expect(result.current(2, erreurApi(403))).toBe(false);
    });

    it('refuse tout réessai sur un 404, même sous un client dont le défaut réessaierait indéfiniment', () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: true } } });
      const { result } = renderHook(() => useDoitReessayer(), {
        wrapper: envelopperClient(queryClient),
      });

      expect(result.current(0, erreurApi(404))).toBe(false);
    });
  });

  describe('tout le reste : rejoue EXACTEMENT la décision du défaut du client ambiant', () => {
    it('client de test (`retry: false`) : aucun réessai sur un 5xx — la panne apparaît sans attendre', () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const { result } = renderHook(() => useDoitReessayer(), {
        wrapper: envelopperClient(queryClient),
      });

      expect(result.current(0, erreurApi(500))).toBe(false);
      expect(result.current(0, new Error('panne réseau'))).toBe(false);
    });

    it('défaut non configuré (client applicatif réel) : rejoue le défaut interne de TanStack Query (jusqu’à 3 tentatives)', () => {
      // `new QueryClient()` sans `defaultOptions.queries.retry` — exactement la construction
      // utilisée par l'application (`App.tsx`), à ne pas confondre avec `creerQueryClientTest()`.
      const queryClient = new QueryClient();
      const { result } = renderHook(() => useDoitReessayer(), {
        wrapper: envelopperClient(queryClient),
      });

      expect(result.current(0, erreurApi(500))).toBe(true);
      expect(result.current(2, erreurApi(500))).toBe(true);
      expect(result.current(3, erreurApi(500))).toBe(false);
    });

    it('défaut numérique explicite du client : rejoue CE nombre, pas le 3 codé en dur de TanStack', () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });
      const { result } = renderHook(() => useDoitReessayer(), {
        wrapper: envelopperClient(queryClient),
      });

      expect(result.current(0, erreurApi(500))).toBe(true);
      expect(result.current(1, erreurApi(500))).toBe(false);
    });

    it('défaut fonction explicite du client : rejoue CETTE fonction, y compris sur une erreur qui ne vient pas de requeteApi', () => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: (nombreEchecs: number) => nombreEchecs < 5 } },
      });
      const { result } = renderHook(() => useDoitReessayer(), {
        wrapper: envelopperClient(queryClient),
      });

      expect(result.current(4, new Error('panne réseau'))).toBe(true);
      expect(result.current(5, new Error('panne réseau'))).toBe(false);
    });
  });
});
