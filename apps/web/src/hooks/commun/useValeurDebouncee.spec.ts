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
    expect(result.current[0]).toBe('Volkswa');
  });

  it('ne répercute la nouvelle valeur qu’après le délai — aucune requête à chaque frappe', () => {
    const { result, rerender } = renderHook(({ valeur }) => useValeurDebouncee(valeur), {
      initialProps: { valeur: 'Volkswa' },
    });

    rerender({ valeur: 'Volkswag' });
    expect(result.current[0]).toBe('Volkswa');

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current[0]).toBe('Volkswa');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current[0]).toBe('Volkswag');
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
    expect(result.current[0]).toBe('V');

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current[0]).toBe('Vol');
  });

  it('respecte un délai personnalisé', () => {
    const { result, rerender } = renderHook(({ valeur }) => useValeurDebouncee(valeur, 500), {
      initialProps: { valeur: 'A' },
    });

    rerender({ valeur: 'AB' });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current[0]).toBe('A');

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current[0]).toBe('AB');
  });

  /**
   * Généralisation `<T>` (déplacement depuis `hooks/vehicules/`) : `EcranDoublonsClients.tsx`
   * temporise un OBJET de critères, pas une chaîne — cette suite couvre ce cas séparément de la
   * suite `string` ci-dessus pour ne pas dépendre implicitement de la comparaison de primitives.
   */
  it('temporise une valeur objet — l’identité de référence, pas une comparaison profonde', () => {
    const { result, rerender } = renderHook(
      ({ valeur }) => useValeurDebouncee<{ nom?: string }>(valeur),
      { initialProps: { valeur: { nom: 'Dupont' } } },
    );

    expect(result.current[0]).toEqual({ nom: 'Dupont' });

    const critereMisAJour = { nom: 'Dupont-Martin' };
    rerender({ valeur: critereMisAJour });
    expect(result.current[0]).toEqual({ nom: 'Dupont' });

    act(() => {
      vi.advanceTimersByTime(300);
    });
    // La référence renvoyée est EXACTEMENT celle passée par l'appelant (pas une recopie) : un
    // appelant qui mémoïse sa construction (`useMemo`) en tire une référence stable en aval.
    expect(result.current[0]).toBe(critereMisAJour);
  });

  /**
   * Levier de reset (arbitrage @laupernoe, 26.08.2026) : un bouton « Effacer les filtres » est un geste
   * de reprise en main, pas une frappe — il ne doit JAMAIS attendre le même délai qu'une
   * recherche. Sans ce test, un futur agent pourrait « simplifier » `reinitialiserImmediat` sans
   * qu'aucun test ne le lui reproche.
   */
  describe('reinitialiserImmediat — le levier de reset', () => {
    it('applique la valeur suivante SANS attendre le délai quand le reset a été demandé', () => {
      const { result, rerender } = renderHook(({ valeur }) => useValeurDebouncee(valeur, 300), {
        initialProps: { valeur: 'Volkswa' },
      });

      const reinitialiserImmediat = result.current[1];
      act(() => {
        reinitialiserImmediat();
      });
      rerender({ valeur: '' });

      // Zéro avancement de minuteur : la valeur est déjà là, contrairement à une temporisation
      // normale qui exigerait `vi.advanceTimersByTime(300)` avant de voir « '' ».
      expect(result.current[0]).toBe('');
    });

    it('ne bypass le délai qu’une seule fois — la frappe suivante redevient temporisée normalement', () => {
      const { result, rerender } = renderHook(({ valeur }) => useValeurDebouncee(valeur, 300), {
        initialProps: { valeur: 'Volkswa' },
      });

      act(() => {
        result.current[1]();
      });
      rerender({ valeur: '' });
      expect(result.current[0]).toBe('');

      // Après le flush, une nouvelle frappe repasse par le délai normal — le drapeau ne reste
      // jamais actif au-delà du changement qui l'a consommé.
      rerender({ valeur: 'A' });
      expect(result.current[0]).toBe('');

      act(() => {
        vi.advanceTimersByTime(299);
      });
      expect(result.current[0]).toBe('');

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(result.current[0]).toBe('A');
    });
  });
});
