import { describe, expect, it } from 'vitest';

import {
  arrondirA5Centimes,
  especesHorsCinqCentimes,
  montantPourMoyen,
  repartirImputations,
} from './montant-encaissement';

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

describe('montantPourMoyen — les dix terminaisons, dans les deux sens (RF-49)', () => {
  it.each([
    // solde, espèces remises, écart (remis - solde)
    [10940, 10940, 0],
    [10941, 10940, -1],
    [10942, 10940, -2],
    [10943, 10945, 2],
    [10944, 10945, 1],
    [10945, 10945, 0],
    [10946, 10945, -1],
    [10947, 10945, -2],
    [10948, 10950, 2],
    [10949, 10950, 1],
  ])('solde %i ct : espèces %i ct, écart %i ct', (solde, remis, ecart) => {
    expect(montantPourMoyen(solde, 'especes')).toEqual({
      montantCentimes: remis,
      ecartArrondiCentimes: ecart,
    });
  });

  it('carte, TWINT et virement restent au centime exact sur un solde finissant par 3 ou 4', () => {
    for (const moyen of ['carte', 'twint', 'virement'] as const) {
      expect(montantPourMoyen(10943, moyen).montantCentimes).toBe(10943);
      expect(montantPourMoyen(10944, moyen).montantCentimes).toBe(10944);
    }
  });
});

describe('repartirImputations — règlement = espèces remises, arrondi signé, jamais d’avance', () => {
  const unique = [{ id: 'f1', soldeCentimes: 10944 }];

  it('109.44 en espèces : règlement 10945 + arrondi -1, rien ne reste non imputé', () => {
    const [imputations] = repartirImputations(
      [{ montantCentimes: 10945, ecartArrondiCentimes: 1 }],
      unique,
    );
    expect(imputations).toEqual([
      { documentId: 'f1', montantCentimes: 10945, nature: 'reglement' },
      { documentId: 'f1', montantCentimes: -1, nature: 'arrondi' },
    ]);
  });

  it.each([
    [10943, 10945, 2, -2],
    [10944, 10945, 1, -1],
    [10948, 10950, 2, -2],
    [10949, 10950, 1, -1],
    [10941, 10940, -1, 1],
    [10942, 10940, -2, 2],
  ])(
    'solde %i, espèces %i : règlement = espèces, arrondi %i ct (écart %i)',
    (solde, remis, ecart, arrondi) => {
      const [imputations] = repartirImputations(
        [{ montantCentimes: remis, ecartArrondiCentimes: ecart }],
        [{ id: 'f1', soldeCentimes: solde }],
      );
      expect(imputations).toEqual([
        { documentId: 'f1', montantCentimes: remis, nature: 'reglement' },
        { documentId: 'f1', montantCentimes: arrondi, nature: 'arrondi' },
      ]);
      const reglements = (imputations ?? [])
        .filter((i) => i.nature === 'reglement')
        .reduce((somme, i) => somme + i.montantCentimes, 0);
      expect(reglements).toBe(remis);
      expect(reglements + arrondi).toBe(solde);
    },
  );

  it('sans écart, aucune imputation d’arrondi', () => {
    const [imputations] = repartirImputations(
      [{ montantCentimes: 10944, ecartArrondiCentimes: null }],
      unique,
    );
    expect(imputations).toEqual([
      { documentId: 'f1', montantCentimes: 10944, nature: 'reglement' },
    ]);
  });

  it('deux factures de 50.02 et 59.42 payées 109.45 : l’arrondi tombe sur la dernière facture soldée', () => {
    const [imputations] = repartirImputations(
      [{ montantCentimes: 10945, ecartArrondiCentimes: 1 }],
      [
        { id: 'f1', soldeCentimes: 5002 },
        { id: 'f2', soldeCentimes: 5942 },
      ],
    );
    expect(imputations).toEqual([
      { documentId: 'f1', montantCentimes: 5002, nature: 'reglement' },
      { documentId: 'f2', montantCentimes: 5943, nature: 'reglement' },
      { documentId: 'f2', montantCentimes: -1, nature: 'arrondi' },
    ]);
  });

  it('carte 50.00 puis espèces 59.45 sur 109.44 : chaque paiement n’impute que son propre montant', () => {
    const [carte, especes] = repartirImputations(
      [
        { montantCentimes: 5000, ecartArrondiCentimes: null },
        { montantCentimes: 5945, ecartArrondiCentimes: 1 },
      ],
      unique,
    );
    expect(carte).toEqual([{ documentId: 'f1', montantCentimes: 5000, nature: 'reglement' }]);
    expect(especes).toEqual([
      { documentId: 'f1', montantCentimes: 5945, nature: 'reglement' },
      { documentId: 'f1', montantCentimes: -1, nature: 'arrondi' },
    ]);
  });

  it('un trop-perçu réel (200.00 sur 109.44) reste non imputé : règlement plafonné au solde, pas d’arrondi', () => {
    const [imputations] = repartirImputations(
      [{ montantCentimes: 20000, ecartArrondiCentimes: null }],
      unique,
    );
    expect(imputations).toEqual([
      { documentId: 'f1', montantCentimes: 10944, nature: 'reglement' },
    ]);
  });
});

describe('especesHorsCinqCentimes', () => {
  it.each([10003, 10001, 10004, 10007])('refuse %i ct en espèces', (c) => {
    expect(especesHorsCinqCentimes('especes', c)).toBe(true);
  });
  it.each([10000, 10005, 5])('accepte %i ct en espèces', (c) => {
    expect(especesHorsCinqCentimes('especes', c)).toBe(false);
  });
  it('ne touche ni la carte, ni TWINT, ni un champ vide', () => {
    expect(especesHorsCinqCentimes('carte', 10003)).toBe(false);
    expect(especesHorsCinqCentimes('twint', 10003)).toBe(false);
    expect(especesHorsCinqCentimes('especes', null)).toBe(false);
  });
});
