import type { PageCurseur, ReponseArticle, ResultatRechercheComptoirArticle } from '@dfa/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

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
    rayon: null,
    tiroir: null,
    estEchangeStandard: false,
    montantConsigneTtcCentimes: null,
    statutSuivi: 'suivi',
  },
];

function articleCatalogue(
  partiel: Partial<ReponseArticle> & { readonly id: string },
): ReponseArticle {
  return {
    numeroArticle: 'P-000000',
    designation: 'Article catalogue',
    marque: null,
    categorie: 'piece_mecanique',
    statut: 'actif',
    referencePrincipale: '0000000',
    codeBarres: null,
    prixAchatCentimes: null,
    prixVenteTtcCentimes: 5000,
    tauxTvaPourmille: 81,
    estEchangeStandard: false,
    montantConsigneTtcCentimes: null,
    referenceRemplacementId: null,
    references: [],
    referencesTronquees: false,
    stocksResume: [],
    creeLe: '2026-01-01T08:00:00.000Z',
    modifieLe: '2026-01-01T08:00:00.000Z',
    ...partiel,
  };
}

function pageArticles(donnees: readonly ReponseArticle[]): PageCurseur<ReponseArticle> {
  return { donnees, curseurSuivant: null, limite: 20 };
}

function enveloppe() {
  const queryClient = creerQueryClientTest();
  return function Enveloppe({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

// Mode PARCOURS (`GET /articles`) sans handler explicite d'un test : catalogue vide par défaut —
// même raison qu'`EcranRechercheComptoirPieces.spec.tsx` (saisie vide dès le premier rendu tant
// qu'aucune frappe n'a eu lieu). Posé en `beforeEach` : `server.use()` donne priorité au handler le
// plus récemment ajouté, donc ce défaut doit être enregistré AVANT le `server.use()` propre à
// chaque test pour ne jamais le masquer.
beforeEach(() => {
  server.use(http.get('/api/v1/articles', () => HttpResponse.json(pageArticles([]))));
});

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

    // Attend directement `resultats`, pas `enChargement` : le mode PARCOURS (catalogue, requête
    // séparée) peut lui-même passer par `enChargement === false` avant que l'anti-rebond (300 ms)
    // n'ait fait basculer le mode sur la recherche — attendre `enChargement` en premier ferait
    // lire `resultats` un cran trop tôt, encore côté catalogue.
    await waitFor(() => expect(result.current.resultats).toEqual(RESULTATS_TEST), {
      timeout: 2000,
    });

    expect(result.current.enChargement).toBe(false);
    expect(requeteRecue?.get('q')).toBe('1K0698151');
    expect(requeteRecue?.get('siteId')).toBe('site-1');
  });

  /**
   * Contrat changé depuis l'introduction du mode PARCOURS (docs/en-tête du hook) : `null` est
   * désormais réservé au SEUL cas « aucun site sélectionné ». Un site choisi + saisie vide n'est
   * plus une case en attente — c'est le catalogue actif du site, parcourable (constat testeur :
   * « il faut taper une référence que je ne connais pas »). L'ancienne version de ce test attendait
   * `null` ici ; elle contredisait directement le contrat désormais documenté sur
   * `EtatRechercheComptoirPieces.resultats` et a été mise à jour, pas affaiblie.
   */
  it("revient au catalogue parcourable (jamais figé sur l'ancien résultat de recherche) quand la saisie est effacée", async () => {
    server.use(
      http.get('/api/v1/articles/recherche-comptoir', () => HttpResponse.json(RESULTATS_TEST)),
      http.get('/api/v1/articles', () =>
        HttpResponse.json(
          pageArticles([articleCatalogue({ id: 'art-catalogue', designation: 'Filtre à huile' })]),
        ),
      ),
    );
    const { result } = renderHook(() => useRechercheComptoirPieces('site-1'), {
      wrapper: enveloppe(),
    });

    act(() => result.current.onSaisieChange('1K0698151'));
    await waitFor(() => expect(result.current.resultats).toEqual(RESULTATS_TEST));

    act(() => result.current.onSaisieChange(''));

    // Ni `null` (un site EST sélectionné) ni l'ancien résultat de recherche figé (`RESULTATS_TEST`,
    // article `art-1`) : le catalogue parcourable, distinct par construction (`art-catalogue`).
    await waitFor(() => {
      expect(result.current.enParcours).toBe(true);
      expect(result.current.resultats).toEqual([
        expect.objectContaining({ articleId: 'art-catalogue', designation: 'Filtre à huile' }),
      ]);
    });
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

  describe('mode parcours (saisie vide, site sélectionné)', () => {
    it('liste le catalogue actif du site, trié par désignation, sans attendre de frappe', async () => {
      let parametresRecus: URLSearchParams | undefined;
      server.use(
        http.get('/api/v1/articles', ({ request }) => {
          parametresRecus = new URL(request.url).searchParams;
          return HttpResponse.json(
            pageArticles([
              articleCatalogue({ id: 'art-catalogue', designation: 'Filtre à huile' }),
            ]),
          );
        }),
      );

      const { result } = renderHook(() => useRechercheComptoirPieces('site-1'), {
        wrapper: enveloppe(),
      });

      expect(result.current.enParcours).toBe(true);

      await waitFor(() =>
        expect(result.current.resultats).toEqual([
          expect.objectContaining({ articleId: 'art-catalogue' }),
        ]),
      );
      expect(parametresRecus?.get('statut')).toBe('actif');
      expect(parametresRecus?.get('tri')).toBe('designation:asc');
      // Pagination du mode PARCOURS : aucune page suivante ici (`curseurSuivant: null`).
      expect(result.current.aDavantage).toBe(false);
    });

    it('`chargerDavantage` demande la page suivante par curseur et accumule sur la première page', async () => {
      server.use(
        http.get('/api/v1/articles', ({ request }) => {
          const curseur = new URL(request.url).searchParams.get('curseur');
          if (!curseur) {
            return HttpResponse.json({
              donnees: [articleCatalogue({ id: 'art-page-1', designation: 'Filtre à huile' })],
              curseurSuivant: 'curseur-2',
              limite: 20,
            });
          }
          return HttpResponse.json(
            pageArticles([articleCatalogue({ id: 'art-page-2', designation: 'Filtre à air' })]),
          );
        }),
      );

      const { result } = renderHook(() => useRechercheComptoirPieces('site-1'), {
        wrapper: enveloppe(),
      });

      await waitFor(() => expect(result.current.aDavantage).toBe(true));
      expect(result.current.resultats).toEqual([
        expect.objectContaining({ articleId: 'art-page-1' }),
      ]);

      act(() => result.current.chargerDavantage());

      await waitFor(() =>
        expect(result.current.resultats).toEqual([
          expect.objectContaining({ articleId: 'art-page-1' }),
          expect.objectContaining({ articleId: 'art-page-2' }),
        ]),
      );
    });

    it('une frappe désactive le catalogue et bascule sur la recherche — les deux modes ne tournent jamais ensemble', async () => {
      let appelsCatalogue = 0;
      server.use(
        http.get('/api/v1/articles', () => {
          appelsCatalogue += 1;
          return HttpResponse.json(pageArticles([]));
        }),
        http.get('/api/v1/articles/recherche-comptoir', () => HttpResponse.json(RESULTATS_TEST)),
      );

      const { result } = renderHook(() => useRechercheComptoirPieces('site-1'), {
        wrapper: enveloppe(),
      });

      await waitFor(() => expect(result.current.enChargement).toBe(false));
      const appelsAvantSaisie = appelsCatalogue;

      act(() => result.current.onSaisieChange('1K0698151'));

      await waitFor(() => expect(result.current.enParcours).toBe(false), { timeout: 2000 });
      await waitFor(() => expect(result.current.resultats).toEqual(RESULTATS_TEST));
      // Pas de nouvel appel catalogue déclenché par la frappe (`charger` devient `undefined` dès
      // que le mode bascule — voir la garde `enParcours && siteId !== undefined` dans le hook).
      expect(appelsCatalogue).toBe(appelsAvantSaisie);
    });
  });
});
