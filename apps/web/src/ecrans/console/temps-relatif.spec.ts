import { describe, expect, it } from 'vitest';

import { calculerDureeEcouleeConsole, palierAccessibleDureeConsole } from './temps-relatif';

const MAINTENANT = new Date('2026-08-08T12:00:00.000Z');

describe('calculerDureeEcouleeConsole', () => {
  it('rend la granularité minute sous une heure', () => {
    expect(calculerDureeEcouleeConsole('2026-08-08T11:56:00.000Z', MAINTENANT)).toEqual({
      granularite: 'minute',
      valeur: 4,
    });
  });

  it('rend 0 minute pour un horodatage à l’instant', () => {
    expect(calculerDureeEcouleeConsole('2026-08-08T11:59:30.000Z', MAINTENANT)).toEqual({
      granularite: 'minute',
      valeur: 0,
    });
  });

  it('bascule en heure à partir de 60 minutes', () => {
    expect(calculerDureeEcouleeConsole('2026-08-08T11:00:00.000Z', MAINTENANT)).toEqual({
      granularite: 'heure',
      valeur: 1,
    });
  });

  it('bascule en jour à partir de 24 heures', () => {
    expect(calculerDureeEcouleeConsole('2026-08-06T12:00:00.000Z', MAINTENANT)).toEqual({
      granularite: 'jour',
      valeur: 2,
    });
  });

  it('ne rend jamais une durée négative pour un horodatage futur (horloge légèrement désynchronisée)', () => {
    expect(calculerDureeEcouleeConsole('2026-08-08T12:05:00.000Z', MAINTENANT)).toEqual({
      granularite: 'minute',
      valeur: 0,
    });
  });
});

describe('palierAccessibleDureeConsole', () => {
  it('classe les paliers aux bornes exactes', () => {
    expect(palierAccessibleDureeConsole(0)).toBe('moins5Min');
    expect(palierAccessibleDureeConsole(5 * 60 - 1)).toBe('moins5Min');
    expect(palierAccessibleDureeConsole(5 * 60)).toBe('moins30Min');
    expect(palierAccessibleDureeConsole(30 * 60)).toBe('moins1h');
    expect(palierAccessibleDureeConsole(60 * 60)).toBe('plus1h');
    expect(palierAccessibleDureeConsole(60 * 60 * 5)).toBe('plus1h');
  });
});
