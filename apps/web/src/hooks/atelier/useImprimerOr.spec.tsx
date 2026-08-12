import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErreurApi } from '@/api/erreurs';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { useImprimerOr } from './useImprimerOr';

/**
 * `GET /ordres-reparation/{orId}/pdf` — jamais mis en cache côté client (contrairement au PDF de
 * facture, immuable), toujours régénéré. La fenêtre cible est fournie par l'APPELANT (voir
 * `BoutonImprimerOr.tsx` — `window.open()` doit rester synchrone dans son `onClick`, jamais dans
 * ce hook, sous peine de bloqueur de popups) : ce test l'injecte donc directement via `mutate()`,
 * exactement comme le fait le composant réel. Preuves attendues :
 *  - une réponse non-ok en `problem+json` produit une `ErreurApi` exploitable, jamais un PDF
 *    cassé affiché tel quel, et referme la fenêtre fournie ;
 *  - chaque appel obtient sa PROPRE URL d'objet, jamais celle d'un appel précédent — l'ancienne
 *    n'est révoquée qu'une fois la nouvelle prête, jamais avant.
 */

function enveloppe(queryClient: ReturnType<typeof creerQueryClientTest>) {
  return function Enveloppe({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function construireFenetreFactice() {
  return { close: vi.fn(), location: { href: '' } } as unknown as Window;
}

describe('useImprimerOr', () => {
  let compteurUrl = 0;
  let creerObjectUrl: ReturnType<typeof vi.fn>;
  let revoquerObjectUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    compteurUrl = 0;
    creerObjectUrl = vi.fn(() => `blob:objet-${++compteurUrl}`);
    revoquerObjectUrl = vi.fn();
    // jsdom ne fournit pas `URL.createObjectURL`/`revokeObjectURL` — même patron que
    // `navigator.clipboard` dans `BoutonCopier.spec.tsx` (stub direct, restauré après coup).
    Object.defineProperty(URL, 'createObjectURL', { value: creerObjectUrl, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revoquerObjectUrl, configurable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('charge le PDF reçu dans la fenêtre fournie, via sa propre URL d’objet', async () => {
    server.use(
      http.get('/api/v1/ordres-reparation/or-1/pdf', () =>
        HttpResponse.arrayBuffer(new TextEncoder().encode('%PDF-1.4 contenu factice').buffer, {
          headers: { 'content-type': 'application/pdf' },
        }),
      ),
    );

    const { result } = renderHook(() => useImprimerOr('or-1'), {
      wrapper: enveloppe(creerQueryClientTest()),
    });
    const fenetre = construireFenetreFactice();

    act(() => {
      result.current.mutate(fenetre);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(creerObjectUrl).toHaveBeenCalledTimes(1);
    expect((fenetre as unknown as { location: { href: string } }).location.href).toBe(
      'blob:objet-1',
    );
    // Rien à révoquer au premier appel : aucune URL précédente n'existait.
    expect(revoquerObjectUrl).not.toHaveBeenCalled();
  });

  it('sur un refus problem+json, construit une ErreurApi exploitable et referme la fenêtre fournie', async () => {
    server.use(
      http.get('/api/v1/ordres-reparation/or-1/pdf', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur interne',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: 'req-1',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    const { result } = renderHook(() => useImprimerOr('or-1'), {
      wrapper: enveloppe(creerQueryClientTest()),
    });
    const fenetre = construireFenetreFactice();

    act(() => {
      result.current.mutate(fenetre);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.error).toBeInstanceOf(ErreurApi);
    expect((result.current.error as ErreurApi).probleme.code).toBe('ERREUR_INTERNE');
    expect((fenetre as unknown as { close: () => void }).close).toHaveBeenCalledTimes(1);
    expect(creerObjectUrl).not.toHaveBeenCalled();
  });

  it('un appel avec `fenetre: null` (popup refusée) n’échoue pas — replie sur un lien invisible', async () => {
    server.use(
      http.get('/api/v1/ordres-reparation/or-1/pdf', () =>
        HttpResponse.arrayBuffer(new TextEncoder().encode('%PDF-1.4').buffer, {
          headers: { 'content-type': 'application/pdf' },
        }),
      ),
    );
    const clicSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const { result } = renderHook(() => useImprimerOr('or-1'), {
      wrapper: enveloppe(creerQueryClientTest()),
    });

    act(() => {
      result.current.mutate(null);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(clicSpy).toHaveBeenCalledTimes(1);
  });

  it('un second appel obtient sa propre URL et révoque la précédente une fois la nouvelle prête — jamais avant, jamais réutilisée', async () => {
    server.use(
      http.get('/api/v1/ordres-reparation/or-1/pdf', () =>
        HttpResponse.arrayBuffer(new TextEncoder().encode('%PDF-1.4').buffer, {
          headers: { 'content-type': 'application/pdf' },
        }),
      ),
    );

    const { result } = renderHook(() => useImprimerOr('or-1'), {
      wrapper: enveloppe(creerQueryClientTest()),
    });
    const premiereFenetre = construireFenetreFactice();
    const secondeFenetre = construireFenetreFactice();

    act(() => {
      result.current.mutate(premiereFenetre);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(revoquerObjectUrl).not.toHaveBeenCalled();

    act(() => {
      result.current.mutate(secondeFenetre);
    });
    await waitFor(() => expect(creerObjectUrl).toHaveBeenCalledTimes(2));

    expect(revoquerObjectUrl).toHaveBeenCalledTimes(1);
    expect(revoquerObjectUrl).toHaveBeenCalledWith('blob:objet-1');
    expect((secondeFenetre as unknown as { location: { href: string } }).location.href).toBe(
      'blob:objet-2',
    );
  });
});
