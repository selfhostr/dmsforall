import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useModeScanMobile } from './useModeScanMobile';

/**
 * Contrat vérifié ici : DEUX signaux exigés ensemble (`max-width: 767px` ET `pointer: coarse`,
 * voir la doc de tête d'`useModeScanMobile.ts`), la restriction ne s'applique qu'aux rôles
 * `ROLES_SCAN`, et l'échappatoire (`quitter()`) désactive la restriction pour la session en cours
 * — trois affirmations distinctes du brief, testées séparément plutôt qu'en un seul gros test qui
 * masquerait laquelle casserait en cas de régression.
 */

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

describe('useModeScanMobile', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('téléphone détecté + rôle autorisé -> restriction active', () => {
    installerMatchMedia(true);
    const { result } = renderHook(() => useModeScanMobile('receptionnaire'));
    expect(result.current.actif).toBe(true);
  });

  it('téléphone NON détecté (poste fixe, fenêtre étroite comprise) -> jamais restreint', () => {
    installerMatchMedia(false);
    const { result } = renderHook(() => useModeScanMobile('receptionnaire'));
    expect(result.current.actif).toBe(false);
  });

  it('téléphone détecté mais rôle hors ROLES_SCAN (ex. technicien, atterrissage propre) -> pas de restriction imposée', () => {
    installerMatchMedia(true);
    const { result } = renderHook(() => useModeScanMobile('technicien'));
    expect(result.current.actif).toBe(false);
  });

  it('rôle non résolu (session en cours de chargement) -> pas de restriction tant que le rôle est inconnu', () => {
    installerMatchMedia(true);
    const { result } = renderHook(() => useModeScanMobile(undefined));
    expect(result.current.actif).toBe(false);
  });

  it('les cinq rôles ROLES_SCAN déclenchent la restriction sur téléphone, aucun autre', () => {
    installerMatchMedia(true);
    const autorises = [
      'admin',
      'direction',
      'receptionnaire',
      'chef_atelier',
      'magasinier',
    ] as const;
    const refuses = ['technicien', 'comptable', 'vendeur', 'poste_atelier'] as const;
    for (const role of autorises) {
      const { result } = renderHook(() => useModeScanMobile(role));
      expect(result.current.actif, `rôle ${role} devrait être restreint`).toBe(true);
    }
    for (const role of refuses) {
      const { result } = renderHook(() => useModeScanMobile(role));
      expect(result.current.actif, `rôle ${role} ne devrait pas être restreint`).toBe(false);
    }
  });

  it('quitter() désactive la restriction immédiatement, sans attendre un nouveau rendu externe', () => {
    installerMatchMedia(true);
    const { result } = renderHook(() => useModeScanMobile('receptionnaire'));
    expect(result.current.actif).toBe(true);

    act(() => result.current.quitter());

    expect(result.current.actif).toBe(false);
  });

  it('quitter() persiste (sessionStorage) : un nouveau montage sur le même onglet reste hors restriction', () => {
    installerMatchMedia(true);
    const premier = renderHook(() => useModeScanMobile('receptionnaire'));
    act(() => premier.result.current.quitter());
    premier.unmount();

    const second = renderHook(() => useModeScanMobile('receptionnaire'));
    expect(second.result.current.actif).toBe(false);
  });

  it('un `sessionStorage` qui lève (navigation privée stricte) ne fait pas planter le hook', () => {
    installerMatchMedia(true);
    const getItemOriginal = window.sessionStorage.getItem.bind(window.sessionStorage);
    vi.spyOn(window.sessionStorage, 'getItem').mockImplementation((cle) => {
      if (cle === 'dfa.scanMobile.echappement') throw new Error('quota dépassé');
      return getItemOriginal(cle);
    });

    expect(() => renderHook(() => useModeScanMobile('receptionnaire'))).not.toThrow();
  });

  it('un changement de correspondance media (rotation, redimensionnement) est écouté et réévalue `actif`', () => {
    const liste = installerMatchMedia(true);
    const { result } = renderHook(() => useModeScanMobile('receptionnaire'));
    expect(result.current.actif).toBe(true);
    expect(liste.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

    const gestionnaire = liste.addEventListener.mock.calls[0]?.[1] as (
      evenement: MediaQueryListEvent,
    ) => void;
    act(() => gestionnaire({ matches: false } as MediaQueryListEvent));

    expect(result.current.actif).toBe(false);
  });
});
