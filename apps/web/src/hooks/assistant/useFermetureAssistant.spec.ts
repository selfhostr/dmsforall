import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useFermetureAssistant } from './useFermetureAssistant';

describe('useFermetureAssistant', () => {
  beforeEach(() => window.localStorage.clear());

  it('mémorise la fermeture par utilisateur et par garage', () => {
    const a = renderHook(() => useFermetureAssistant('garage-1', 'u-1'));
    expect(a.result.current.ferme).toBe(false);
    act(() => a.result.current.memoriserFermeture());
    expect(a.result.current.ferme).toBe(true);

    expect(renderHook(() => useFermetureAssistant('garage-1', 'u-1')).result.current.ferme).toBe(
      true,
    );
    expect(renderHook(() => useFermetureAssistant('garage-1', 'u-2')).result.current.ferme).toBe(
      false,
    );
    expect(renderHook(() => useFermetureAssistant('garage-2', 'u-1')).result.current.ferme).toBe(
      false,
    );
  });

  it("sans identité connue : jamais fermé, rien d'écrit", () => {
    const { result } = renderHook(() => useFermetureAssistant(undefined, undefined));
    act(() => result.current.memoriserFermeture());
    expect(result.current.ferme).toBe(false);
    expect(window.localStorage.length).toBe(0);
  });
});
