import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EvenementTempsReel } from '@dfa/shared';

import { useEvenementsTempsReel } from './useEvenementsTempsReel';

/**
 * Faux `EventSource` minimal — jsdom n'implémente pas cette API. Ne simule QUE ce que le hook
 * utilise réellement : `onopen`/`onmessage`/`onerror`, `close()`, et garde trace des instances
 * créées pour que chaque test pilote leurs événements à la main (pas de vrai réseau, pas de timer
 * caché de la classe native).
 */
class FauxEventSource {
  static instances: FauxEventSource[] = [];
  readonly url: string;
  readonly withCredentials: boolean;
  fermee = false;
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string, options?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = options?.withCredentials ?? false;
    FauxEventSource.instances.push(this);
  }

  close(): void {
    this.fermee = true;
  }
}

describe('useEvenementsTempsReel', () => {
  beforeEach(() => {
    FauxEventSource.instances = [];
    vi.stubGlobal('EventSource', FauxEventSource);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('ouvre une connexion avec credentials vers /evenements-temps-reel/flux', () => {
    renderHook(() => useEvenementsTempsReel(vi.fn()));

    expect(FauxEventSource.instances).toHaveLength(1);
    const source = FauxEventSource.instances[0]!;
    expect(source.url).toBe('/api/v1/evenements-temps-reel/flux');
    expect(source.withCredentials).toBe(true);
  });

  it('passe en "connecte" à onopen puis relaie les messages désérialisés au callback', () => {
    const surEvenement = vi.fn();
    const { result } = renderHook(() => useEvenementsTempsReel(surEvenement));
    const source = FauxEventSource.instances[0]!;

    expect(result.current).toBe('connexion');

    act(() => source.onopen?.());
    expect(result.current).toBe('connecte');

    const evenement: EvenementTempsReel = {
      type: 'vehicule.correspondance_scan_permis',
      emisLe: '2026-08-16T10:00:00.000Z',
      donnees: { clientId: 'client-1' },
    };
    act(() => source.onmessage?.({ data: JSON.stringify(evenement) }));

    expect(surEvenement).toHaveBeenCalledTimes(1);
    expect(surEvenement).toHaveBeenCalledWith(evenement);
  });

  it('un message JSON malformé est ignoré, ne casse pas le flux', () => {
    const surEvenement = vi.fn();
    renderHook(() => useEvenementsTempsReel(surEvenement));
    const source = FauxEventSource.instances[0]!;

    act(() => source.onmessage?.({ data: '{ pas du json' }));

    expect(surEvenement).not.toHaveBeenCalled();
  });

  it('sur erreur : ferme la connexion, passe en "reconnexion", puis rouvre après un délai avec retrait progressif', () => {
    const { result } = renderHook(() => useEvenementsTempsReel(vi.fn()));
    const premiere = FauxEventSource.instances[0]!;

    act(() => premiere.onerror?.());
    expect(premiere.fermee).toBe(true);
    expect(result.current).toBe('reconnexion');
    // Toujours une seule instance : la reconnexion n'est pas immédiate.
    expect(FauxEventSource.instances).toHaveLength(1);

    // Premier délai : borne à [1000, 1250) ms (DELAI_INITIAL_MS + gigue).
    act(() => vi.advanceTimersByTime(1250));
    expect(FauxEventSource.instances).toHaveLength(2);

    const deuxieme = FauxEventSource.instances[1]!;
    act(() => deuxieme.onerror?.());
    // Deuxième délai doublé : borne à [2000, 2250) ms — ne doit PAS avoir rouvert à 1250ms.
    act(() => vi.advanceTimersByTime(1250));
    expect(FauxEventSource.instances).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1000));
    expect(FauxEventSource.instances).toHaveLength(3);
  });

  it('le délai de reconnexion est réinitialisé après une reconnexion réussie (onopen)', () => {
    renderHook(() => useEvenementsTempsReel(vi.fn()));
    let source = FauxEventSource.instances[0]!;

    act(() => source.onerror?.());
    act(() => vi.advanceTimersByTime(1250));
    source = FauxEventSource.instances[1]!;
    act(() => source.onopen?.()); // succès : le compteur de backoff repart à zéro

    act(() => source.onerror?.());
    act(() => vi.advanceTimersByTime(1250)); // si le délai n'avait pas été réinitialisé, ce serait 2000-2250ms
    expect(FauxEventSource.instances).toHaveLength(3);
  });

  it('au démontage : ferme la connexion et annule toute reconnexion programmée', () => {
    // `result.current` n'est PAS réévalué après un démontage (React ne re-rend pas un composant
    // disparu) : le passage à `'ferme'` dans le nettoyage de l'effet est défensif pour un
    // consommateur qui lirait l'état pendant le démontage, pas observable ici — ce test vérifie
    // donc l'effet réel (fermeture + annulation de la reconnexion), pas cet état transitoire.
    const { unmount } = renderHook(() => useEvenementsTempsReel(vi.fn()));
    const source = FauxEventSource.instances[0]!;

    act(() => source.onerror?.()); // programme une reconnexion
    unmount();

    expect(source.fermee).toBe(true);

    // La reconnexion programmée avant le démontage ne doit pas ouvrir de nouvelle connexion.
    act(() => vi.advanceTimersByTime(30_000));
    expect(FauxEventSource.instances).toHaveLength(1);
  });
});
