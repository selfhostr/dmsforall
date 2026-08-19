import { describe, expect, it } from 'vitest';

import { filtrerParCoherenceWmi } from './wmi-marques';

describe('filtrerParCoherenceWmi', () => {
  it('marque null -> candidats inchangés (rien à contredire)', () => {
    expect(filtrerParCoherenceWmi(['WVWZZZ1KZAW123456', 'JMBCT4CZ3DYK9NY46'], null)).toEqual([
      'WVWZZZ1KZAW123456',
      'JMBCT4CZ3DYK9NY46',
    ]);
  });

  it('marque absente de la table curatée -> candidats inchangés, jamais un rejet par défaut', () => {
    expect(filtrerParCoherenceWmi(['1M8GDM9AXKP042788'], 'MARQUE-INCONNUE-XYZ')).toEqual([
      '1M8GDM9AXKP042788',
    ]);
  });

  it('un seul candidat, WMI cohérent avec la marque connue -> conservé', () => {
    expect(filtrerParCoherenceWmi(['WVWZZZ1KZAW123456'], 'VOLKSWAGEN')).toEqual([
      'WVWZZZ1KZAW123456',
    ]);
  });

  it('un seul candidat, WMI EN CONTRADICTION avec la marque connue -> écarté (liste vide), jamais gardé par défaut', () => {
    expect(filtrerParCoherenceWmi(['1M8GDM9AXKP042788'], 'VOLKSWAGEN')).toEqual([]);
  });

  it('plusieurs candidats -> réduit à ceux dont le WMI correspond à la marque connue (WMI Mitsubishi : JMB/JA3 — pas JM8, ni WVW)', () => {
    expect(
      filtrerParCoherenceWmi(
        ['JMBCT4CZ3DYK9NY46', 'JM8CT4CZ30YK9NY46', 'WVWZZZ1KZAW123456'],
        'MITSUBISHI',
      ),
    ).toEqual(['JMBCT4CZ3DYK9NY46']);
  });

  it('marque insensible à la casse et aux séparateurs (« Mercedes-Benz » comme « MERCEDES BENZ »)', () => {
    expect(filtrerParCoherenceWmi(['WDB1234567890ABCD'], 'Mercedes-Benz')).toEqual([
      'WDB1234567890ABCD',
    ]);
  });

  it('aucun candidat ne correspond au WMI de la marque connue -> liste vide', () => {
    expect(
      filtrerParCoherenceWmi(['1M8GDM9AXKP042788', 'JMBCT4CZ3DYK9NY46'], 'VOLKSWAGEN'),
    ).toEqual([]);
  });

  it('liste de candidats vide -> reste vide, quelle que soit la marque', () => {
    expect(filtrerParCoherenceWmi([], 'VOLKSWAGEN')).toEqual([]);
  });
});
