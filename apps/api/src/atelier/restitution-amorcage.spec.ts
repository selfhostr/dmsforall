import { describe, expect, it } from 'vitest';

import { calculerRestitutionAmorcee } from './restitution-amorcage';

describe('calculerRestitutionAmorcee — amorçage de restitution_promise_le depuis le RDV', () => {
  it('heure souhaitée fixée : point de départ = heure souhaitée + durée estimée', () => {
    const resultat = calculerRestitutionAmorcee({
      dateLe: '2026-08-20',
      moment: 'matin',
      heureSouhaitee: '08:00',
      dureeEstimeeMinutes: 60,
    });
    expect(resultat.toISOString()).toBe('2026-08-20T09:00:00.000Z');
  });

  it('heure souhaitée absente, moment "matin" : repli sur la fin conventionnelle du moment (12:00)', () => {
    const resultat = calculerRestitutionAmorcee({
      dateLe: '2026-08-20',
      moment: 'matin',
      heureSouhaitee: null,
      dureeEstimeeMinutes: 30,
    });
    expect(resultat.toISOString()).toBe('2026-08-20T12:30:00.000Z');
  });

  it('heure souhaitée absente, moment "toute_journee" : repli sur 18:00', () => {
    const resultat = calculerRestitutionAmorcee({
      dateLe: '2026-08-20',
      moment: 'toute_journee',
      heureSouhaitee: null,
      dureeEstimeeMinutes: 90,
    });
    expect(resultat.toISOString()).toBe('2026-08-20T19:30:00.000Z');
  });

  it('accepte une heure au format HH:MM:SS (colonne "time" Postgres)', () => {
    const resultat = calculerRestitutionAmorcee({
      dateLe: '2026-08-05',
      moment: 'matin',
      heureSouhaitee: '08:00:00',
      dureeEstimeeMinutes: 45,
    });
    expect(resultat.toISOString()).toBe('2026-08-05T08:45:00.000Z');
  });

  it('durée estimée cumulée sur plusieurs heures traverse correctement le changement de jour', () => {
    const resultat = calculerRestitutionAmorcee({
      dateLe: '2026-08-20',
      moment: 'apres_midi',
      heureSouhaitee: '23:30',
      dureeEstimeeMinutes: 90,
    });
    expect(resultat.toISOString()).toBe('2026-08-21T01:00:00.000Z');
  });
});
