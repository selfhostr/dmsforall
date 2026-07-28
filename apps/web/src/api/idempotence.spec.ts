import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { genererCleIdempotence, useCleIdempotence } from './idempotence';

const REGEX_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('genererCleIdempotence', () => {
  it('produit un uuid v4', () => {
    expect(genererCleIdempotence()).toMatch(REGEX_UUID_V4);
  });

  it('produit une clé distincte à chaque appel', () => {
    expect(genererCleIdempotence()).not.toBe(genererCleIdempotence());
  });
});

describe('useCleIdempotence', () => {
  it('génère une clé au montage, une seule fois', () => {
    const { result, rerender } = renderHook(() => useCleIdempotence());
    const cleInitiale = result.current.cle;
    expect(cleInitiale).toMatch(REGEX_UUID_V4);

    // Deux soumissions du même formulaire (double-clic, retry après timeout) doivent porter la
    // MÊME Idempotency-Key : re-render sans appeler `regenerer()` ne doit donc jamais changer la
    // clé (critère de done n°4 du plan F1-01).
    rerender();
    expect(result.current.cle).toBe(cleInitiale);
  });

  it('régénère une nouvelle clé uniquement quand regenerer() est appelé explicitement', () => {
    const { result } = renderHook(() => useCleIdempotence());
    const cleInitiale = result.current.cle;

    act(() => {
      result.current.regenerer();
    });

    expect(result.current.cle).not.toBe(cleInitiale);
    expect(result.current.cle).toMatch(REGEX_UUID_V4);
  });

  it('deux instances indépendantes (deux formulaires ouverts) ont des clés distinctes', () => {
    const { result: formulaireA } = renderHook(() => useCleIdempotence());
    const { result: formulaireB } = renderHook(() => useCleIdempotence());
    expect(formulaireA.current.cle).not.toBe(formulaireB.current.cle);
  });
});
