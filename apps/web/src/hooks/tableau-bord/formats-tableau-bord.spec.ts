import { describe, expect, it } from 'vitest';

import { formaterDureeMoyenneTableauBord } from './formats-tableau-bord';

describe('formaterDureeMoyenneTableauBord', () => {
  it('renvoie null pour une absence de donnée (aucun OR restitué sur la période)', () => {
    expect(formaterDureeMoyenneTableauBord(null)).toBeNull();
  });

  it('décompose en minutes seules en dessous d’une heure, jamais de composante "heures"', () => {
    expect(formaterDureeMoyenneTableauBord(45)).toEqual({
      granularite: 'minutes',
      jours: 0,
      heures: 0,
      minutes: 45,
    });
    expect(formaterDureeMoyenneTableauBord(1)).toEqual({
      granularite: 'minutes',
      jours: 0,
      heures: 0,
      minutes: 1,
    });
  });

  it('décompose "0 minute" pour un délai nul (distinct de `null`, une vraie mesure à zéro)', () => {
    expect(formaterDureeMoyenneTableauBord(0)).toEqual({
      granularite: 'minutes',
      jours: 0,
      heures: 0,
      minutes: 0,
    });
  });

  it('décompose heures + minutes entre 1h et 24h', () => {
    expect(formaterDureeMoyenneTableauBord(200)).toEqual({
      granularite: 'heuresMinutes',
      jours: 0,
      heures: 3,
      minutes: 20,
    });
    expect(formaterDureeMoyenneTableauBord(60)).toEqual({
      granularite: 'heuresMinutes',
      jours: 0,
      heures: 1,
      minutes: 0,
    });
    expect(formaterDureeMoyenneTableauBord(1439)).toEqual({
      granularite: 'heuresMinutes',
      jours: 0,
      heures: 23,
      minutes: 59,
    });
  });

  it('décompose jours + heures au-delà de 24h, granularité "jours" seule si les heures résiduelles sont nulles', () => {
    expect(formaterDureeMoyenneTableauBord(24 * 60)).toEqual({
      granularite: 'jours',
      jours: 1,
      heures: 0,
      minutes: 0,
    });
    expect(formaterDureeMoyenneTableauBord(2 * 24 * 60 + 4 * 60)).toEqual({
      granularite: 'joursHeures',
      jours: 2,
      heures: 4,
      minutes: 0,
    });
    expect(formaterDureeMoyenneTableauBord(2 * 24 * 60 + 30)).toEqual({
      granularite: 'jours',
      jours: 2,
      heures: 0,
      minutes: 0,
    });
  });
});
