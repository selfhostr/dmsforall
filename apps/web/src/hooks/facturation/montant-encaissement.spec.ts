import { describe, expect, it } from 'vitest';

import { arrondirA5Centimes, montantPourMoyen } from './montant-encaissement';

describe('montantPourMoyen', () => {
  it('arrondit les espèces au 5 centimes et expose l’écart', () => {
    expect(montantPourMoyen(10944, 'especes')).toEqual({
      montantCentimes: 10945,
      ecartArrondiCentimes: 1,
    });
    expect(montantPourMoyen(10942, 'especes')).toEqual({
      montantCentimes: 10940,
      ecartArrondiCentimes: -2,
    });
  });

  it('garde le montant exact pour tout autre moyen', () => {
    for (const moyen of ['carte', 'twint', 'virement', 'qr'] as const) {
      expect(montantPourMoyen(10944, moyen)).toEqual({
        montantCentimes: 10944,
        ecartArrondiCentimes: 0,
      });
    }
  });

  it('ne change rien quand le montant est déjà un multiple de 5 centimes', () => {
    expect(montantPourMoyen(10945, 'especes')).toEqual({
      montantCentimes: 10945,
      ecartArrondiCentimes: 0,
    });
    expect(arrondirA5Centimes(0)).toBe(0);
  });
});
