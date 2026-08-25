import { describe, expect, it } from 'vitest';
import { dateMaxPlausibleTable, profilerColonnes } from './profilage';
import type { LigneTable } from './types';

function lignes(valeurs: (Record<string, unknown> | undefined)[]): LigneTable[] {
  return valeurs.map((v, i) => ({ index: i, valeurs: (v ?? {}) as Record<string, never> }));
}

describe('profilerColonnes', () => {
  it('distingue NULL, chaîne vide et espaces seuls (jamais le même taux de remplissage)', () => {
    const l = lignes([{ X: 'valeur' }, { X: null }, { X: '' }, { X: '   ' }, { X: 'autre' }]);
    const profil = profilerColonnes(['X'], l)[0]!;
    expect(profil.remplis).toBe(2);
    expect(profil.nulls).toBe(1);
    expect(profil.vides).toBe(1);
    expect(profil.espacesSeuls).toBe(1);
    expect(profil.tauxRemplissage).toBeCloseTo(2 / 5, 5);
  });

  it("un champ absent de l'objet valeurs compte comme NULL", () => {
    const l = lignes([{}, { X: 'présent' }]);
    const profil = profilerColonnes(['X'], l)[0]!;
    expect(profil.nulls).toBe(1);
    expect(profil.remplis).toBe(1);
  });

  it('détecte le format de date texte aaaa.mm.jj (piège mesuré, distinct de jj.mm.aaaa)', () => {
    const l = lignes([{ D: '2024.03.15' }, { D: '2023.12.01' }, { D: '2022.01.31' }]);
    const profil = profilerColonnes(['D'], l)[0]!;
    expect(profil.formatDateDetecte).toBe('aaaa.mm.jj');
  });

  it('détecte le format de date texte jj.mm.aaaa quand il domine', () => {
    const l = lignes([{ D: '15.03.2024' }, { D: '01.12.2023' }, { D: '31.01.2022' }]);
    const profil = profilerColonnes(['D'], l)[0]!;
    expect(profil.formatDateDetecte).toBe('jj.mm.aaaa');
  });

  it('signale les dates aberrantes (bug de siècle produisant une année future lointaine)', () => {
    const l = lignes([{ D: '15.03.2024' }, { D: '01.12.9999' }, { D: '31.01.2022' }]);
    const profil = profilerColonnes(['D'], l)[0]!;
    expect(profil.datesAberrantes).toBe(1);
  });

  it('ne détecte aucun format quand la colonne ne contient pas de motif date texte', () => {
    const l = lignes([{ D: 'abc' }, { D: 'def' }]);
    const profil = profilerColonnes(['D'], l)[0]!;
    expect(profil.formatDateDetecte).toBeUndefined();
  });
});

describe('dateMaxPlausibleTable', () => {
  it('retient la date la plus récente et plausible, tous types de colonnes confondus', () => {
    const l = lignes([
      { D1: new Date(Date.UTC(2023, 0, 1)), D2: '15.06.2024' },
      { D1: new Date(Date.UTC(2020, 0, 1)), D2: '01.01.2019' },
    ]);
    const max = dateMaxPlausibleTable(['D1', 'D2'], l);
    expect(max?.toISOString()).toBe('2024-06-15T00:00:00.000Z');
  });

  it('exclut une date aberrante (bug de siècle) du calcul de fraîcheur', () => {
    const l = lignes([
      { D: new Date(Date.UTC(2023, 5, 1)) },
      { D: new Date(Date.UTC(9999, 0, 1)) },
    ]);
    const max = dateMaxPlausibleTable(['D'], l);
    expect(max?.getUTCFullYear()).toBe(2023);
  });

  it("rend null en l'absence de toute date plausible", () => {
    const l = lignes([{ D: 'pas une date' }]);
    expect(dateMaxPlausibleTable(['D'], l)).toBeNull();
  });
});
