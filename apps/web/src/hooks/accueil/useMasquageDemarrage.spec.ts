import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useMasquageDemarrage } from './useMasquageDemarrage';

describe('useMasquageDemarrage', () => {
  beforeEach(() => window.localStorage.clear());

  it('visible par défaut, puis masqué et persisté pour CET utilisateur seulement', () => {
    const a = renderHook(() => useMasquageDemarrage('u-a'));
    expect(a.result.current.masque).toBe(false);
    act(() => a.result.current.masquer());
    expect(a.result.current.masque).toBe(true);
    expect(window.localStorage.getItem('dfa.demarrage.masque.u-a')).toBe('1');

    // Rechargement de la page : toujours masqué pour A, pas pour B.
    expect(renderHook(() => useMasquageDemarrage('u-a')).result.current.masque).toBe(true);
    expect(renderHook(() => useMasquageDemarrage('u-b')).result.current.masque).toBe(false);
  });

  it('sans utilisateur, rien n’est masqué ni écrit', () => {
    const { result } = renderHook(() => useMasquageDemarrage(undefined));
    act(() => result.current.masquer());
    expect(result.current.masque).toBe(false);
    expect(window.localStorage.length).toBe(0);
  });
});
