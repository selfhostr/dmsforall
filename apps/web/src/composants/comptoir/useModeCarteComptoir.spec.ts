import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useModeCarteComptoir } from './useModeCarteComptoir';

/** Même patron de test que `useModeScanMobile.spec.ts` (composants/layout/) : `matchMedia`
 *  simulé, changement écouté en direct. */

interface FausseMediaQueryList {
  matches: boolean;
  readonly addEventListener: ReturnType<typeof vi.fn>;
  readonly removeEventListener: ReturnType<typeof vi.fn>;
}

function installerMatchMedia(correspond: boolean): FausseMediaQueryList {
  const liste: FausseMediaQueryList = {
    matches: correspond,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue(liste) as unknown as typeof window.matchMedia,
  );
  return liste;
}

describe('useModeCarteComptoir', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sous le palier (téléphone) -> mode carte actif', () => {
    installerMatchMedia(true);
    const { result } = renderHook(() => useModeCarteComptoir());
    expect(result.current).toBe(true);
  });

  it('au-dessus du palier (tablette/bureau) -> mode carte inactif', () => {
    installerMatchMedia(false);
    const { result } = renderHook(() => useModeCarteComptoir());
    expect(result.current).toBe(false);
  });

  it('un changement de correspondance (rotation, redimensionnement) est écouté et réévalue', () => {
    const liste = installerMatchMedia(false);
    const { result } = renderHook(() => useModeCarteComptoir());
    expect(result.current).toBe(false);
    expect(liste.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

    const gestionnaire = liste.addEventListener.mock.calls[0]?.[1] as (
      evenement: MediaQueryListEvent,
    ) => void;
    act(() => gestionnaire({ matches: true } as MediaQueryListEvent));

    expect(result.current).toBe(true);
  });

  it("sans `matchMedia` (environnement sans support) -> pas d'erreur, mode carte inactif", () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(() => renderHook(() => useModeCarteComptoir())).not.toThrow();
    const { result } = renderHook(() => useModeCarteComptoir());
    expect(result.current).toBe(false);
  });
});
