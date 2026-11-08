import { describe, expect, it } from 'vitest';

import {
  ARRONDI_ESPECES_MAGNITUDE_MAX_CENTIMES,
  verifierArrondiEspeces,
  verifierEspecesMultiple5,
  type ContexteVerificationArrondi,
} from './arrondi-especes';

function contexte(champs: Partial<ContexteVerificationArrondi> = {}): ContexteVerificationArrondi {
  return {
    moyenPaiement: 'especes',
    arrondiEspecesActif: true,
    totalDocumentCentimes: 20431n,
    montantRegleAvantCentimes: 0n,
    sommeReglementLotCentimes: 20430n,
    arrondiCentimes: 1n,
    paiementMontantCentimes: 20430n,
    ...champs,
  };
}

describe('verifierArrondiEspeces — RF-49 : uniquement les espèces', () => {
  it('accepte un arrondi qui solde exactement en espèces (204.31 → 204.30 + 0.01, CF-05)', () => {
    expect(() => verifierArrondiEspeces(contexte())).not.toThrow();
  });

  it.each(['carte', 'virement', 'qr', 'twint', 'compensation', 'leasing'] as const)(
    "refuse l'arrondi sur le moyen '%s' — jamais absorbé hors espèces",
    (moyen) => {
      expect(() => verifierArrondiEspeces(contexte({ moyenPaiement: moyen }))).toThrow(
        expect.objectContaining({ code: 'VALIDATION_ECHOUEE' }),
      );
    },
  );
});

describe('verifierArrondiEspeces — PF-05/AC-20 : paramètre tenant', () => {
  it('refuse toute imputation arrondi quand arrondi_especes_actif est désactivé, même en espèces', () => {
    expect(() => verifierArrondiEspeces(contexte({ arrondiEspecesActif: false }))).toThrow(
      expect.objectContaining({ code: 'CONFLIT' }),
    );
  });
});

describe('verifierArrondiEspeces — RF-51 : magnitude bornée à ±2 centimes', () => {
  it.each([-2n, -1n, 1n, 2n])(
    'accepte %d centimes s’il solde exactement le document',
    (arrondi) => {
      const total = 20430n + arrondi;
      expect(() =>
        verifierArrondiEspeces(
          contexte({
            totalDocumentCentimes: total < 0n ? -total : total,
            arrondiCentimes: arrondi,
            sommeReglementLotCentimes: 20430n,
          }),
        ),
      ).not.toThrow();
    },
  );

  it.each([-5n, -3n, 3n, 5n, 100n])(
    'refuse %d centimes, hors de la borne ±2 (RF-51)',
    (arrondi) => {
      const total = 20430n + arrondi;
      expect(() =>
        verifierArrondiEspeces(
          contexte({
            totalDocumentCentimes: total < 0n ? -total : total,
            arrondiCentimes: arrondi,
            sommeReglementLotCentimes: 20430n,
          }),
        ),
      ).toThrow(expect.objectContaining({ code: 'VALIDATION_ECHOUEE' }));
    },
  );

  it(`la borne exportée vaut ${ARRONDI_ESPECES_MAGNITUDE_MAX_CENTIMES} centimes`, () => {
    expect(ARRONDI_ESPECES_MAGNITUDE_MAX_CENTIMES).toBe(2);
  });
});

describe('verifierArrondiEspeces — RF-49 : uniquement ce qui SOLDE le document', () => {
  it('refuse un arrondi qui laisse un reliquat ouvert (le règlement ne couvre pas le total, même à 1 ct près)', () => {
    expect(() =>
      verifierArrondiEspeces(
        contexte({
          totalDocumentCentimes: 50000n,
          sommeReglementLotCentimes: 40000n,
          arrondiCentimes: 1n,
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION_ECHOUEE' }));
  });

  it('refuse un arrondi qui, cumulé au montant déjà réglé AVANT ce lot, dépasserait le total (ne solde pas exactement)', () => {
    expect(() =>
      verifierArrondiEspeces(
        contexte({
          totalDocumentCentimes: 1000n,
          montantRegleAvantCentimes: 500n,
          sommeReglementLotCentimes: 501n,
          arrondiCentimes: 1n,
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION_ECHOUEE' }));
  });

  it('accepte un arrondi qui ferme exactement un reliquat après un règlement déjà partiel', () => {
    // 1000 total, 500 déjà réglé, ce lot règle 499 en espèces + 1 d'arrondi = 1000 pile.
    expect(() =>
      verifierArrondiEspeces(
        contexte({
          totalDocumentCentimes: 1000n,
          montantRegleAvantCentimes: 500n,
          sommeReglementLotCentimes: 499n,
          arrondiCentimes: 1n,
        }),
      ),
    ).not.toThrow();
  });
});

describe('verifierArrondiEspeces — arrondi vers le haut ET vers le bas (RF-52, CF-05)', () => {
  // Terminaison du solde → espèces remises → arrondi signé de l'imputation.
  it.each([
    { solde: 10941n, especes: 10940n, arrondi: 1n },
    { solde: 10942n, especes: 10940n, arrondi: 2n },
    { solde: 10943n, especes: 10945n, arrondi: -2n },
    { solde: 10944n, especes: 10945n, arrondi: -1n },
    { solde: 10946n, especes: 10945n, arrondi: 1n },
    { solde: 10947n, especes: 10945n, arrondi: 2n },
    { solde: 10948n, especes: 10950n, arrondi: -2n },
    { solde: 10949n, especes: 10950n, arrondi: -1n },
  ])(
    'solde $solde ct payé $especes ct en espèces : arrondi $arrondi ct accepté',
    ({ solde, especes, arrondi }) => {
      expect(() =>
        verifierArrondiEspeces(
          contexte({
            totalDocumentCentimes: solde,
            sommeReglementLotCentimes: especes,
            paiementMontantCentimes: especes,
            arrondiCentimes: arrondi,
          }),
        ),
      ).not.toThrow();
    },
  );

  it('refuse un encaissement dont le montant n’est pas un multiple de 5 ct (109.44 payé 109.46 + arrondi -2)', () => {
    expect(() =>
      verifierArrondiEspeces(
        contexte({
          totalDocumentCentimes: 10944n,
          sommeReglementLotCentimes: 10946n,
          paiementMontantCentimes: 10946n,
          arrondiCentimes: -2n,
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION_ECHOUEE' }));
  });

  it('refuse un arrondi négatif sur une carte : jamais absorbé hors espèces', () => {
    expect(() =>
      verifierArrondiEspeces(
        contexte({
          moyenPaiement: 'carte',
          totalDocumentCentimes: 10944n,
          sommeReglementLotCentimes: 10945n,
          paiementMontantCentimes: 10945n,
          arrondiCentimes: -1n,
        }),
      ),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION_ECHOUEE' }));
  });
});

describe('verifierEspecesMultiple5 — recette #64 (espèces 100.03)', () => {
  const base = {
    moyenPaiement: 'especes',
    devise: 'CHF',
    arrondiEspecesActif: true,
    montantCentimes: 10003n,
  } as const;

  it.each([10003n, 10001n, 10004n, 10007n, 1n])('refuse %s ct en espèces CHF', (montantCentimes) => {
    expect(() => verifierEspecesMultiple5({ ...base, montantCentimes })).toThrow(/multiple de 5/);
  });

  it.each([10000n, 10005n, 5n, 1310005n])('accepte %s ct en espèces CHF', (montantCentimes) => {
    expect(() => verifierEspecesMultiple5({ ...base, montantCentimes })).not.toThrow();
  });

  it('ne contraint ni la carte, ni une autre devise, ni un tenant sans arrondi', () => {
    expect(() => verifierEspecesMultiple5({ ...base, moyenPaiement: 'carte' })).not.toThrow();
    expect(() => verifierEspecesMultiple5({ ...base, devise: 'EUR' })).not.toThrow();
    expect(() => verifierEspecesMultiple5({ ...base, arrondiEspecesActif: false })).not.toThrow();
  });
});
