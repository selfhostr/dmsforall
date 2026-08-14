import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { lireBrouillon } from './brouillon';
import { useSauvegardeBrouillon } from './useSauvegardeBrouillon';

interface ValeursTest {
  readonly demandeClient: string;
  readonly kilometrage: number | null;
}

describe('useSauvegardeBrouillon', () => {
  afterEach(() => {
    window.sessionStorage.clear();
  });

  it('écrit le brouillon dès le premier rendu', () => {
    const valeurs: ValeursTest = { demandeClient: 'Vidange + contrôle freins', kilometrage: null };
    renderHook(() => useSauvegardeBrouillon('nouvel-or', valeurs));

    expect(lireBrouillon<ValeursTest>('nouvel-or')?.valeurs).toEqual(valeurs);
  });

  it('remplace le brouillon quand `valeurs` change (frappe suivante)', () => {
    const { rerender } = renderHook(
      ({ valeurs }: { valeurs: ValeursTest }) => useSauvegardeBrouillon('nouvel-or', valeurs),
      {
        initialProps: { valeurs: { demandeClient: 'Bru', kilometrage: null as number | null } },
      },
    );

    rerender({ valeurs: { demandeClient: 'Bruit au freinage', kilometrage: 84200 } });

    expect(lireBrouillon<ValeursTest>('nouvel-or')?.valeurs).toEqual({
      demandeClient: 'Bruit au freinage',
      kilometrage: 84200,
    });
  });

  it('`cle` undefined : n’écrit jamais, même à répétition', () => {
    const { rerender } = renderHook(
      ({ valeurs }: { valeurs: ValeursTest }) => useSauvegardeBrouillon(undefined, valeurs),
      { initialProps: { valeurs: { demandeClient: 'x', kilometrage: 1 } } },
    );
    rerender({ valeurs: { demandeClient: 'y', kilometrage: 2 } });

    expect(window.sessionStorage.length).toBe(0);
  });

  it('n’écrit pas deux fois pour un contenu identique (nouvelle référence, même valeur)', () => {
    const ecrireBrouillonSpy = vi.spyOn(window.Storage.prototype, 'setItem');
    const { rerender } = renderHook(
      ({ valeurs }: { valeurs: ValeursTest }) => useSauvegardeBrouillon('nouvel-or', valeurs),
      { initialProps: { valeurs: { demandeClient: 'x', kilometrage: 1 } } },
    );
    const appelsApresPremierRendu = ecrireBrouillonSpy.mock.calls.length;

    // Nouvelle référence d'objet, contenu strictement identique — imite un parent qui re-rend sans
    // que l'utilisateur ait retapé quoi que ce soit.
    rerender({ valeurs: { demandeClient: 'x', kilometrage: 1 } });

    expect(ecrireBrouillonSpy.mock.calls.length).toBe(appelsApresPremierRendu);
    ecrireBrouillonSpy.mockRestore();
  });
});
