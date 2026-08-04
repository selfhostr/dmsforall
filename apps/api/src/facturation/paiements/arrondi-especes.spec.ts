import { describe, expect, it } from 'vitest';

import {
  ARRONDI_ESPECES_MAGNITUDE_MAX_CENTIMES,
  verifierArrondiEspeces,
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

describe('verifierArrondiEspeces — arrondi vers le haut ET vers le bas (RF-52)', () => {
  it('204.33 → 204.35 (arrondi +2) accepté au même titre que 204.31 → 204.30 (arrondi +1) : jamais un sens privilégié', () => {
    expect(() =>
      verifierArrondiEspeces(
        contexte({
          totalDocumentCentimes: 20433n,
          sommeReglementLotCentimes: 20431n,
          arrondiCentimes: 2n,
        }),
      ),
    ).not.toThrow();
  });

  it('un arrondi négatif (le règlement en espèces dépasse le total nominal) est accepté dans les mêmes bornes', () => {
    expect(() =>
      verifierArrondiEspeces(
        contexte({
          totalDocumentCentimes: 20428n,
          sommeReglementLotCentimes: 20430n,
          arrondiCentimes: -2n,
        }),
      ),
    ).not.toThrow();
  });
});
