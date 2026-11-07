import { act, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SynchronisationDensite } from '@/composants/commun/SynchronisationDensite';

import {
  CLE_STOCKAGE_DENSITE,
  REQUETE_LARGEUR_TABLETTE,
  REQUETE_POINTEUR_GROSSIER,
  definirPreferenceDensite,
  reinitialiserDensite,
  resoudreDensite,
  useDensite,
} from './useDensite';

function simulerAppareil(options: { pointeurGrossier: boolean; etroit: boolean }): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((requete: string) => ({
      matches:
        requete === REQUETE_POINTEUR_GROSSIER
          ? options.pointeurGrossier
          : requete === REQUETE_LARGEUR_TABLETTE
            ? options.etroit
            : false,
      media: requete,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe('resoudreDensite', () => {
  it('suit l’appareil en mode automatique', () => {
    expect(resoudreDensite('auto', false, false)).toBe('compacte');
    expect(resoudreDensite('auto', true, false)).toBe('aeree');
    expect(resoudreDensite('auto', false, true)).toBe('aeree');
  });

  it('la préférence explicite l’emporte sur l’appareil', () => {
    expect(resoudreDensite('compacte', true, true)).toBe('compacte');
    expect(resoudreDensite('aeree', false, false)).toBe('aeree');
  });
});

describe('useDensite', () => {
  beforeEach(() => {
    window.localStorage.clear();
    reinitialiserDensite();
    document.documentElement.className = '';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.clear();
    reinitialiserDensite();
  });

  it('souris sur grand écran : compacte, classe densite-dense sur <html>', () => {
    simulerAppareil({ pointeurGrossier: false, etroit: false });
    render(<SynchronisationDensite />);
    expect(document.documentElement).toHaveClass('densite-dense');
    expect(document.documentElement).not.toHaveClass('densite-aeree');
  });

  it('pointeur grossier (tablette) : aérée, classe densite-aeree sur <html>', () => {
    simulerAppareil({ pointeurGrossier: true, etroit: false });
    render(<SynchronisationDensite />);
    expect(document.documentElement).toHaveClass('densite-aeree');
    expect(document.documentElement).not.toHaveClass('densite-dense');
  });

  it('fenêtre étroite (< 1024 px) à la souris : aérée', () => {
    simulerAppareil({ pointeurGrossier: false, etroit: true });
    const { result } = renderHook(() => useDensite());
    expect(result.current.densite).toBe('aeree');
  });

  it('mémorise le choix de l’utilisateur et bascule la classe racine', () => {
    simulerAppareil({ pointeurGrossier: true, etroit: false });
    render(<SynchronisationDensite />);
    const { result } = renderHook(() => useDensite());

    act(() => result.current.definirPreference('compacte'));

    expect(window.localStorage.getItem(CLE_STOCKAGE_DENSITE)).toBe('compacte');
    expect(document.documentElement).toHaveClass('densite-dense');
    expect(document.documentElement.dataset['densite']).toBe('compacte');

    act(() => definirPreferenceDensite('auto'));
    expect(window.localStorage.getItem(CLE_STOCKAGE_DENSITE)).toBeNull();
    expect(document.documentElement).toHaveClass('densite-aeree');
  });

  it('ignore une valeur stockée invalide', () => {
    simulerAppareil({ pointeurGrossier: false, etroit: false });
    window.localStorage.setItem(CLE_STOCKAGE_DENSITE, 'enorme');
    reinitialiserDensite();
    const { result } = renderHook(() => useDensite());
    expect(result.current.preference).toBe('auto');
    expect(screen.queryByText('x')).toBeNull();
  });
});
