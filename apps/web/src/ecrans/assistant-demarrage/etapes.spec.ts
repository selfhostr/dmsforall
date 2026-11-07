import { describe, expect, it } from 'vitest';

import { ETAPES_ASSISTANT, etapePassable, etapePrecedente, etapeSuivante } from './etapes';

describe("étapes de l'assistant", () => {
  it('seule la première étape est obligatoire', () => {
    expect(ETAPES_ASSISTANT.filter((e) => !etapePassable(e))).toEqual(['garage', 'termine']);
    expect(etapePassable('paiements')).toBe(true);
    expect(etapePassable('modules')).toBe(true);
  });
  it('avance et recule sans sortir des bornes', () => {
    expect(etapeSuivante('garage')).toBe('modules');
    expect(etapeSuivante('modules')).toBe('paiements');
    expect(etapeSuivante('termine')).toBe('termine');
    expect(etapePrecedente('garage')).toBe('garage');
    expect(etapePrecedente('termine')).toBe('equipe');
  });
});
