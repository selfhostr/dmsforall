import { describe, expect, it } from 'vitest';

import {
  CORRESPONDANCE_LANGUE,
  CORRESPONDANCE_TYPE_CLIENT,
  convertirVersEnum,
} from './correspondance-enum-reprise';

describe('convertirVersEnum', () => {
  it('valeur source reconnue (insensible à la casse/espaces) -> convertie', () => {
    expect(convertirVersEnum('Particulier', CORRESPONDANCE_TYPE_CLIENT)).toEqual({
      valeur: 'particulier',
      inconnue: false,
      valeurSourceBrute: 'Particulier',
    });
    expect(convertirVersEnum('  Société  ', CORRESPONDANCE_TYPE_CLIENT)).toEqual({
      valeur: 'entreprise',
      inconnue: false,
      valeurSourceBrute: '  Société  ',
    });
  });

  it("valeur ABSENTE de la table -> inconnue:true, ne JETTE JAMAIS — c'est le point du brief", () => {
    const resultat = convertirVersEnum('coopérative agricole', CORRESPONDANCE_TYPE_CLIENT);
    expect(resultat.inconnue).toBe(true);
    expect(resultat.valeur).toBeNull();
    expect(resultat.valeurSourceBrute).toBe('coopérative agricole');
  });

  it('null/undefined/vide -> valeur null, inconnue FAUX (absence ≠ valeur inconnue)', () => {
    expect(convertirVersEnum(null, CORRESPONDANCE_TYPE_CLIENT)).toEqual({
      valeur: null,
      inconnue: false,
      valeurSourceBrute: null,
    });
    expect(convertirVersEnum(undefined, CORRESPONDANCE_TYPE_CLIENT)).toEqual({
      valeur: null,
      inconnue: false,
      valeurSourceBrute: null,
    });
    expect(convertirVersEnum('   ', CORRESPONDANCE_TYPE_CLIENT)).toEqual({
      valeur: null,
      inconnue: false,
      valeurSourceBrute: null,
    });
  });

  it('table langue : variantes DE/IT reconnues', () => {
    expect(convertirVersEnum('Deutsch', CORRESPONDANCE_LANGUE).valeur).toBe('de');
    expect(convertirVersEnum('italiano', CORRESPONDANCE_LANGUE).valeur).toBe('it');
    expect(convertirVersEnum('espagnol', CORRESPONDANCE_LANGUE).inconnue).toBe(true);
  });
});
