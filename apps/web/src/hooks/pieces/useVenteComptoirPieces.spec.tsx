import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { delay, http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ReponseMouvementStock } from '@dfa/shared';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { useRetourClientComptoir, useVenteComptoir } from './useVenteComptoirPieces';

/**
 * `useVenteComptoir`/`useRetourClientComptoir` orchestrent `POST /articles/{id}/mouvements/
 * sortie-comptoir` et `.../retour-client` — LE geste n°1 du magasinier une fois la pièce trouvée
 * au comptoir. Même piège d'idempotence que `useCreationOrdreReparation` (voir son en-tête) :
 * la clé vit dans un `useRef`, régénérée SEULEMENT après un succès — un double-clic (deux appels
 * avant toute résolution) doit porter la MÊME clé, pour que le serveur reconnaisse un rejeu et ne
 * sorte la pièce qu'une seule fois.
 */

function enveloppe() {
  const queryClient = creerQueryClientTest();
  return function Enveloppe({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

const MOUVEMENT_SORTIE: ReponseMouvementStock = {
  id: 'mvt-sortie-1',
  articleId: 'article-1',
  type: 'sortie_comptoir',
  quantiteMillieme: -1000,
  siteId: 'site-1',
  siteSourceId: null,
  siteDestinationId: null,
  prixAchatReelCentimes: null,
  auteurId: 'utilisateur-1',
  motif: null,
  ligneOrId: null,
  documentVenteLigneId: null,
  commandeFournisseurLigneId: null,
  inventaireReferenceId: null,
  reservationId: null,
  creeLe: '2026-08-05T09:00:00.000Z',
};

const MOUVEMENT_RETOUR: ReponseMouvementStock = {
  ...MOUVEMENT_SORTIE,
  id: 'mvt-retour-1',
  type: 'retour_client',
  quantiteMillieme: 1000,
  motif: 'Pièce non montée, rapportée par le client',
};

describe('useVenteComptoir (sortie comptoir)', () => {
  it('sortie nominale : POST sortie-comptoir avec la clé Idempotency-Key, onSuccess reçoit le mouvement', async () => {
    let corpsRecu: unknown;
    let cleRecue: string | null = null;
    server.use(
      http.post('/api/v1/articles/:id/mouvements/sortie-comptoir', async ({ request }) => {
        corpsRecu = await request.json();
        cleRecue = request.headers.get('Idempotency-Key');
        return HttpResponse.json(MOUVEMENT_SORTIE, { status: 201 });
      }),
    );

    const onSuccess = vi.fn();
    const { result } = renderHook(() => useVenteComptoir('article-1'), { wrapper: enveloppe() });

    act(() => result.current.vendre({ siteId: 'site-1', quantiteMillieme: 1000 }, { onSuccess }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(MOUVEMENT_SORTIE));
    expect(corpsRecu).toEqual({ siteId: 'site-1', quantiteMillieme: 1000 });
    expect(cleRecue).not.toBeNull();
    expect(result.current.enCours).toBe(false);
    expect(result.current.erreur).toBeNull();
  });

  it('stock insuffisant (409 STOCK_INSUFFISANT) : refusé, `erreur` porte le code, aucun `onSuccess`', async () => {
    server.use(
      http.post('/api/v1/articles/:id/mouvements/sortie-comptoir', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/STOCK_INSUFFISANT',
            title: 'Stock insuffisant',
            status: 409,
            code: 'STOCK_INSUFFISANT',
            instance: 'req-1',
          },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const onSuccess = vi.fn();
    const { result } = renderHook(() => useVenteComptoir('article-1'), { wrapper: enveloppe() });

    act(() => result.current.vendre({ siteId: 'site-1', quantiteMillieme: 5000 }, { onSuccess }));

    await waitFor(() => expect(result.current.enCours).toBe(false));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(result.current.erreur).not.toBeNull();
    expect((result.current.erreur as { probleme?: { code?: string } }).probleme?.code).toBe(
      'STOCK_INSUFFISANT',
    );
  });

  it("un double-clic (deux appels avant résolution) ne sort la pièce qu'une fois : les deux requêtes portent la MÊME clé d'idempotence", async () => {
    const clesRecues: (string | null)[] = [];
    server.use(
      http.post('/api/v1/articles/:id/mouvements/sortie-comptoir', async ({ request }) => {
        clesRecues.push(request.headers.get('Idempotency-Key'));
        // Délai explicite pour garantir que les deux requêtes du double-clic sont bien EN VOL
        // simultanément — même garde que `useCreationOrdreReparation.spec.tsx`.
        await delay(20);
        return HttpResponse.json(MOUVEMENT_SORTIE, { status: 201 });
      }),
    );

    const onSuccess = vi.fn();
    const { result } = renderHook(() => useVenteComptoir('article-1'), { wrapper: enveloppe() });

    act(() => {
      result.current.vendre({ siteId: 'site-1', quantiteMillieme: 1000 }, { onSuccess });
      result.current.vendre({ siteId: 'site-1', quantiteMillieme: 1000 }, { onSuccess });
    });

    await waitFor(() => expect(clesRecues).toHaveLength(2));
    expect(clesRecues[0]).not.toBeNull();
    expect(clesRecues[0]).toBe(clesRecues[1]);
  });

  it('après un succès, la sortie suivante porte une clé différente de la précédente', async () => {
    const cles: (string | null)[] = [];
    server.use(
      http.post('/api/v1/articles/:id/mouvements/sortie-comptoir', async ({ request }) => {
        cles.push(request.headers.get('Idempotency-Key'));
        return HttpResponse.json(MOUVEMENT_SORTIE, { status: 201 });
      }),
    );

    const { result } = renderHook(() => useVenteComptoir('article-1'), { wrapper: enveloppe() });

    act(() =>
      result.current.vendre({ siteId: 'site-1', quantiteMillieme: 1000 }, { onSuccess: () => {} }),
    );
    await waitFor(() => expect(cles).toHaveLength(1));

    act(() =>
      result.current.vendre({ siteId: 'site-1', quantiteMillieme: 1000 }, { onSuccess: () => {} }),
    );
    await waitFor(() => expect(cles).toHaveLength(2));

    expect(cles[1]).not.toBeNull();
    expect(cles[1]).not.toBe(cles[0]);
  });
});

describe('useRetourClientComptoir', () => {
  it('retour client nominal : POST retour-client avec le motif, remet la quantité en stock', async () => {
    let corpsRecu: unknown;
    server.use(
      http.post('/api/v1/articles/:id/mouvements/retour-client', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json(MOUVEMENT_RETOUR, { status: 201 });
      }),
    );

    const onSuccess = vi.fn();
    const { result } = renderHook(() => useRetourClientComptoir('article-1'), {
      wrapper: enveloppe(),
    });

    act(() =>
      result.current.retourner(
        {
          siteId: 'site-1',
          quantiteMillieme: 1000,
          motif: 'Pièce non montée, rapportée par le client',
        },
        { onSuccess },
      ),
    );

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(MOUVEMENT_RETOUR));
    expect(corpsRecu).toEqual({
      siteId: 'site-1',
      quantiteMillieme: 1000,
      motif: 'Pièce non montée, rapportée par le client',
    });
  });

  it("un double-clic sur le retour porte lui aussi la MÊME clé d'idempotence aux deux appels", async () => {
    const clesRecues: (string | null)[] = [];
    server.use(
      http.post('/api/v1/articles/:id/mouvements/retour-client', async ({ request }) => {
        clesRecues.push(request.headers.get('Idempotency-Key'));
        await delay(20);
        return HttpResponse.json(MOUVEMENT_RETOUR, { status: 201 });
      }),
    );

    const { result } = renderHook(() => useRetourClientComptoir('article-1'), {
      wrapper: enveloppe(),
    });

    act(() => {
      result.current.retourner(
        { siteId: 'site-1', quantiteMillieme: 1000, motif: 'Motif de test' },
        { onSuccess: () => {} },
      );
      result.current.retourner(
        { siteId: 'site-1', quantiteMillieme: 1000, motif: 'Motif de test' },
        { onSuccess: () => {} },
      );
    });

    await waitFor(() => expect(clesRecues).toHaveLength(2));
    expect(clesRecues[0]).not.toBeNull();
    expect(clesRecues[0]).toBe(clesRecues[1]);
  });
});
