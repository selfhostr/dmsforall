import { describe, expect, it } from 'vitest';

import { formaterDureeMoyenneTableauBord } from './formats-tableau-bord';

describe('formaterDureeMoyenneTableauBord', () => {
  it('renvoie null pour une absence de donnée (aucun OR restitué sur la période)', () => {
    expect(formaterDureeMoyenneTableauBord(null)).toBeNull();
  });

  it('rend les minutes seules en dessous d’une heure, jamais "0 h"', () => {
    expect(formaterDureeMoyenneTableauBord(45)).toBe('45 min');
    expect(formaterDureeMoyenneTableauBord(1)).toBe('1 min');
  });

  it('rend "0 min" pour un délai nul (distinct de `null`, une vraie mesure à zéro)', () => {
    expect(formaterDureeMoyenneTableauBord(0)).toBe('0 min');
  });

  it('rend heures + minutes entre 1h et 24h', () => {
    expect(formaterDureeMoyenneTableauBord(200)).toBe('3 h 20');
    expect(formaterDureeMoyenneTableauBord(60)).toBe('1 h 00');
    expect(formaterDureeMoyenneTableauBord(1439)).toBe('23 h 59');
  });

  it('rend jours + heures au-delà de 24h, sans heures résiduelles si nulles', () => {
    expect(formaterDureeMoyenneTableauBord(24 * 60)).toBe('1 j');
    expect(formaterDureeMoyenneTableauBord(2 * 24 * 60 + 4 * 60)).toBe('2 j 4 h');
    expect(formaterDureeMoyenneTableauBord(2 * 24 * 60 + 30)).toBe('2 j');
  });
});
