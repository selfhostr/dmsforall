import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useValeurDebouncee } from './useValeurDebouncee';

describe('useValeurDebouncee', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rend la valeur initiale immédiatement, sans attendre le délai', () => {
    const { result } = renderHook(() => useValeurDebouncee('Volkswa'));
    expect(result.current).toBe('Volkswa');
  });

  it('ne répercute la nouvelle valeur qu’après le délai — aucune requête à chaque frappe', () => {
    const { result, rerender } = renderHook(({ valeur }) => useValeurDebouncee(valeur), {
      initialProps: { valeur: 'Volkswa' },
    });

    rerender({ valeur: 'Volkswag' });
    expect(result.current).toBe('Volkswa');

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe('Volkswa');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('Volkswag');
  });

  it('une frappe qui interrompt le délai en cours annule la mise à jour précédente — une seule valeur finale propagée', () => {
    const { result, rerender } = renderHook(({ valeur }) => useValeurDebouncee(valeur), {
      initialProps: { valeur: 'V' },
    });

    rerender({ valeur: 'Vo' });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    rerender({ valeur: 'Vol' });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    // Les 300ms de "Vo" n'ont jamais été atteints d'affilée : toujours la valeur initiale.
    expect(result.current).toBe('V');

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current).toBe('Vol');
  });

  it('respecte un délai personnalisé', () => {
    const { result, rerender } = renderHook(({ valeur }) => useValeurDebouncee(valeur, 500), {
      initialProps: { valeur: 'A' },
    });

    rerender({ valeur: 'AB' });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe('A');

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe('AB');
  });
});
