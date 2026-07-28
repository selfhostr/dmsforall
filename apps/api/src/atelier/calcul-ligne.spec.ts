import { describe, expect, it } from 'vitest';
import type { EntreeCalculLigne } from './atelier.jetons';
import { CalculLigneSimple } from './calcul-ligne';

function entree(surcharge: Partial<EntreeCalculLigne>): EntreeCalculLigne {
  return {
    type: 'piece',
    quantiteMillieme: 1000,
    prixUnitaireCentimes: 10000,
    tempsBaremeCentiemes: null,
    tauxHoraireCentimes: null,
    rabaisPourmille: 0,
    tauxTvaPourmille: 81,
    ...surcharge,
  };
}

describe('CalculLigneSimple', () => {
  const calcul = new CalculLigneSimple();

  it('calcule une ligne pièce sans rabais : brut = prixUnitaire * quantité (millièmes)', () => {
    const m = calcul.calculer(entree({ prixUnitaireCentimes: 10000, quantiteMillieme: 2000 }));
    // 10000 * 2000 / 1000 = 20000 HT, TVA 8.1% arrondie = 1620, TTC = 21620
    expect(m.montantHtCentimes).toBe(20000);
    expect(m.montantTvaCentimes).toBe(1620);
    expect(m.montantTtcCentimes).toBe(21620);
  });

  it('applique le rabais avant la TVA (ordre gelé)', () => {
    const m = calcul.calculer(entree({ prixUnitaireCentimes: 10000, quantiteMillieme: 1000, rabaisPourmille: 100 }));
    // brut 10000, rabais 10% -> HT 9000, TVA 8.1% de 9000 = 729
    expect(m.montantHtCentimes).toBe(9000);
    expect(m.montantTvaCentimes).toBe(729);
    expect(m.montantTtcCentimes).toBe(9729);
  });

  it('calcule une ligne de main d’œuvre depuis le temps barème et le taux horaire figés', () => {
    const m = calcul.calculer(
      entree({ type: 'main_oeuvre_bareme', tempsBaremeCentiemes: 150, tauxHoraireCentimes: 12000, prixUnitaireCentimes: null }),
    );
    // 1.5h * 120.00 CHF/h = 180.00 CHF = 18000 centimes HT
    expect(m.montantHtCentimes).toBe(18000);
    expect(m.montantTvaCentimes).toBe(1458);
    expect(m.montantTtcCentimes).toBe(19458);
  });

  it('accepte un montant négatif (ligne de type remise)', () => {
    const m = calcul.calculer(entree({ type: 'remise', prixUnitaireCentimes: -5000, quantiteMillieme: 1000 }));
    expect(m.montantHtCentimes).toBe(-5000);
    expect(m.montantTtcCentimes).toBeLessThan(0);
  });

  it('garantit montantTtc = montantHt + montantTva (invariant de base)', () => {
    const m = calcul.calculer(entree({ prixUnitaireCentimes: 3333, quantiteMillieme: 700, rabaisPourmille: 137, tauxTvaPourmille: 26 }));
    expect(m.montantTtcCentimes).toBe(m.montantHtCentimes + m.montantTvaCentimes);
  });

  it('totalise plusieurs lignes composante par composante', () => {
    const total = calcul.totaliser([
      { montantHtCentimes: 100, montantTvaCentimes: 8, montantTtcCentimes: 108 },
      { montantHtCentimes: 200, montantTvaCentimes: 16, montantTtcCentimes: 216 },
    ]);
    expect(total).toEqual({ montantHtCentimes: 300, montantTvaCentimes: 24, montantTtcCentimes: 324 });
  });
});
