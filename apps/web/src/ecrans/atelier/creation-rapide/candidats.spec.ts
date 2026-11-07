import { describe, expect, it } from 'vitest';

import type { ResultatRecherche } from '@dfa/shared';

import { candidatDepuisRecherche, candidatEvident, type CandidatVehicule } from './candidats';

function resultat(extra: Partial<ResultatRecherche> = {}): ResultatRecherche {
  return {
    type: 'vehicule',
    id: 'v1',
    score: 1,
    correspondance: { champ: 'plaque', valeur: 'VD123456', historique: false },
    resume: {
      designation: 'VW Golf 7',
      plaque: 'VD123456',
      detenteurNom: 'Dupont Jean',
      ordreReparationOuvert: { id: 'or1', numero: 'OR-1' },
    },
    ...extra,
  };
}

describe('candidatDepuisRecherche', () => {
  it('compose la plaque, nomme le détenteur et signale un OR déjà ouvert', () => {
    expect(candidatDepuisRecherche(resultat())).toEqual({
      id: 'v1',
      designation: 'VW Golf 7',
      plaque: 'VD 123456',
      detenteurNom: 'Dupont Jean',
      orOuvert: true,
      plaqueHistorique: false,
    });
  });

  it("reprend le drapeau d'ancienne plaque de la correspondance", () => {
    const c = candidatDepuisRecherche(
      resultat({ correspondance: { champ: 'plaque', valeur: 'VD1', historique: true } }),
    );
    expect(c.plaqueHistorique).toBe(true);
  });
});

describe('candidatEvident', () => {
  const base: CandidatVehicule = {
    id: 'v1',
    designation: 'x',
    plaque: 'VD 1',
    detenteurNom: null,
    orOuvert: false,
    plaqueHistorique: false,
  };

  it('choisit seul un unique véhicule à plaque courante', () => {
    expect(candidatEvident([base], false)).toBe(base);
  });

  it('ne choisit jamais quand la plaque est interchangeable, historique ou ambiguë', () => {
    expect(candidatEvident([base], true)).toBeNull();
    expect(candidatEvident([{ ...base, plaqueHistorique: true }], false)).toBeNull();
    expect(candidatEvident([base, { ...base, id: 'v2' }], false)).toBeNull();
    expect(candidatEvident([], false)).toBeNull();
  });
});
