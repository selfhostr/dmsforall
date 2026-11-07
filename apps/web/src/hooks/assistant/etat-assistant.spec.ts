import { describe, expect, it } from 'vitest';

import {
  consommerDemandeOuverture,
  demanderOuvertureAssistant,
  memoriserEtapeAssistant,
  reinitialiserEtatAssistant,
  useEtatAssistant,
} from './etat-assistant';
import { renderHook, act } from '@testing-library/react';

describe('etat-assistant', () => {
  it('garde l’étape et la demande de réouverture, la demande se consomme', () => {
    reinitialiserEtatAssistant();
    const { result } = renderHook(() => useEtatAssistant());
    expect(result.current).toEqual({ etape: 'garage', ouvertureDemandee: false });

    act(() => {
      memoriserEtapeAssistant('atelier');
      demanderOuvertureAssistant();
    });
    expect(result.current).toEqual({ etape: 'atelier', ouvertureDemandee: true });

    act(() => consommerDemandeOuverture());
    expect(result.current).toEqual({ etape: 'atelier', ouvertureDemandee: false });
  });
});
