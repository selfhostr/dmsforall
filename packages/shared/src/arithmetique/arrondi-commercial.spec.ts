import { describe, expect, it } from 'vitest';

import { arrondiCommercial, foisArrondiCommercial } from './arrondi-commercial';

describe('arrondiCommercial (MD-40) — seule fonction d’arrondi financier du dépôt', () => {
  it('arrondit au plus proche entier', () => {
    expect(arrondiCommercial(10n, 3n)).toBe(3n); // 3.33 -> 3
    expect(arrondiCommercial(11n, 3n)).toBe(4n); // 3.67 -> 4
  });

  it("à égalité, s'éloigne de zéro — positif et négatif, symétrique (CF-02)", () => {
    expect(arrondiCommercial(5n, 2n)).toBe(3n); // 2.5 -> 3
    expect(arrondiCommercial(-5n, 2n)).toBe(-3n); // -2.5 -> -3 (PAS -2 : un avoir total doit solder au centime)
  });

  it("le cas divergent mesuré entre les deux anciennes implémentations : Math.round(-6.5) valait -6, l'arrondi commercial rend -7", () => {
    // -6500 / 1000 = -6.5 pile. Math.round (arrondit les demis vers +∞) rendait -6 ; la règle
    // commerciale (demi éloigné de zéro) rend -7. C'est EXACTEMENT le centime perdu par la
    // cascade atelier -> facturation avant ce correctif (taux 2.6 %, ht = -250 centimes, voir
    // calcul-ligne.spec.ts).
    expect(arrondiCommercial(-6500n, 1000n)).toBe(-7n);
    expect(arrondiCommercial(6500n, 1000n)).toBe(7n); // le positif, lui, était déjà correct
  });

  it('rejette un dénominateur non strictement positif', () => {
    expect(() => arrondiCommercial(10n, 0n)).toThrow();
    expect(() => arrondiCommercial(10n, -1n)).toThrow();
  });
});

describe('foisArrondiCommercial', () => {
  it('ne perd pas de précision sur un produit qui dépasserait un calcul flottant naïf', () => {
    // 999'999.99 CHF * 1000 millièmes, cas limite plausible d'une ligne extrême.
    expect(foisArrondiCommercial(99_999_999, 1000, 1000)).toBe(99_999_999);
  });

  it('cas à la demie exacte (x.005 CHF), dans les deux sens de signe', () => {
    // 250 centimes * 26‰ / 1000 = 6.5 centimes pile (TVA réduite 2.6 % sur CHF 2.50).
    expect(foisArrondiCommercial(250, 26, 1000)).toBe(7); // 6.5 -> 7 (loin de zéro)
    expect(foisArrondiCommercial(-250, 26, 1000)).toBe(-7); // -6.5 -> -7, symétrique
  });
});
