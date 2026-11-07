import { describe, expect, it } from 'vitest';

import type { ContexteTenant, TransactionDfa } from '../../db';

import {
  chargerSituationTva,
  REGIME_NON_ASSUJETTI,
  normaliserTauxEtRegime,
  verifierEmissionSelonAssujettissement,
} from './assujettissement';

const NON_ASSUJETTI = { assujetti: false, numeroTva: null } as const;
const ASSUJETTI_AVEC_NUMERO = { assujetti: true, numeroTva: 'CHE-116.281.710 TVA' } as const;
const ASSUJETTI_SANS_NUMERO = { assujetti: true, numeroTva: null } as const;

const A_0 = { numeroOrdre: 1, tauxTvaPourmille: 0 };
const A_81 = { numeroOrdre: 2, tauxTvaPourmille: 81 };
const A_26 = { numeroOrdre: 3, tauxTvaPourmille: 26 };

function code(f: () => void): unknown {
  try {
    f();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
}

describe('régime d’un non-assujetti', () => {
  it('est « exclu » (hors champ de l’impôt), jamais « normal » à 0 %', () => {
    expect(REGIME_NON_ASSUJETTI).toBe('exclu');
  });
});

describe('verifierEmissionSelonAssujettissement — garage non assujetti', () => {
  it.each(['facture', 'devis', 'bon_commande'])('%s : lignes à 0 ‰ acceptées', (type) => {
    expect(() =>
      verifierEmissionSelonAssujettissement(NON_ASSUJETTI, type, [A_0, A_0]),
    ).not.toThrow();
  });

  it.each(['facture', 'devis', 'bon_commande'])('%s : une ligne à 81 ‰ est refusée', (type) => {
    expect(
      code(() => verifierEmissionSelonAssujettissement(NON_ASSUJETTI, type, [A_0, A_81])),
    ).toBe('TVA_NON_ASSUJETTI_TAUX_INTERDIT');
  });

  it('nomme chaque ligne fautive (numéro d’ordre et taux)', () => {
    let erreur: { erreurs?: Array<{ champ: string; code: string }> } | undefined;
    try {
      verifierEmissionSelonAssujettissement(NON_ASSUJETTI, 'facture', [A_0, A_81, A_26]);
    } catch (e) {
      erreur = e as typeof erreur;
    }
    expect(erreur?.erreurs?.map((x) => x.champ)).toEqual([
      'lignes[2].tauxTvaPourmille',
      'lignes[3].tauxTvaPourmille',
    ]);
    expect(erreur?.erreurs?.every((x) => x.code === 'taux_tva_interdit_non_assujetti')).toBe(true);
  });

  it('un taux de 1 ‰ (le plus petit) est refusé : seul 0 passe', () => {
    expect(
      code(() =>
        verifierEmissionSelonAssujettissement(NON_ASSUJETTI, 'facture', [
          { numeroOrdre: 1, tauxTvaPourmille: 1 },
        ]),
      ),
    ).toBe('TVA_NON_ASSUJETTI_TAUX_INTERDIT');
  });

  it('un avoir reprend les lignes de la facture corrigée : jamais refusé pour son taux', () => {
    expect(() =>
      verifierEmissionSelonAssujettissement(NON_ASSUJETTI, 'avoir', [A_81]),
    ).not.toThrow();
  });

  it('n’exige jamais de n° TVA', () => {
    expect(() =>
      verifierEmissionSelonAssujettissement(NON_ASSUJETTI, 'facture', [A_0]),
    ).not.toThrow();
  });
});

describe('verifierEmissionSelonAssujettissement — garage assujetti', () => {
  it('avec n° TVA : tout passe, taux 81/26 compris', () => {
    for (const type of ['facture', 'avoir', 'devis', 'bon_commande']) {
      expect(() =>
        verifierEmissionSelonAssujettissement(ASSUJETTI_AVEC_NUMERO, type, [A_0, A_81, A_26]),
      ).not.toThrow();
    }
  });

  it.each(['facture', 'avoir'])('sans n° TVA : %s refusée (TVA_NUMERO_REQUIS)', (type) => {
    expect(
      code(() => verifierEmissionSelonAssujettissement(ASSUJETTI_SANS_NUMERO, type, [A_81])),
    ).toBe('TVA_NUMERO_REQUIS');
  });

  it('un n° TVA fait d’espaces compte comme absent', () => {
    expect(
      code(() =>
        verifierEmissionSelonAssujettissement({ assujetti: true, numeroTva: '   ' }, 'facture', [
          A_81,
        ]),
      ),
    ).toBe('TVA_NUMERO_REQUIS');
  });

  it.each(['devis', 'bon_commande'])(
    'sans n° TVA : %s reste émissible (pas une facture)',
    (type) => {
      expect(() =>
        verifierEmissionSelonAssujettissement(ASSUJETTI_SANS_NUMERO, type, [A_81]),
      ).not.toThrow();
    },
  );
});

describe('chargerSituationTva', () => {
  const ctx: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'u', requeteId: null };

  function txRendant(lignes: unknown[]): TransactionDfa {
    return {
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(lignes) }) }) }),
    } as unknown as TransactionDfa;
  }

  it('relit l’assujettissement et le n° du tenant courant', async () => {
    expect(
      await chargerSituationTva(txRendant([{ assujetti: false, numeroTva: null }]), ctx),
    ).toEqual({ assujetti: false, numeroTva: null });
  });

  it('tenant introuvable : RESSOURCE_INTROUVABLE, jamais « assujetti » par défaut', async () => {
    await expect(chargerSituationTva(txRendant([]), ctx)).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
    });
  });
});

describe('normaliserTauxEtRegime', () => {
  const NON = { assujetti: false, numeroTva: null } as const;
  const OUI = { assujetti: true, numeroTva: 'CHE-1' } as const;

  it('non assujetti : taux absent = 0, régime exclu', () => {
    expect(
      normaliserTauxEtRegime(NON, { tauxTvaPourmille: undefined, regimeTva: 'normal' }),
    ).toEqual({ tauxTvaPourmille: 0, regimeTva: 'exclu' });
  });

  it('non assujetti : taux 0 explicite accepté, régime forcé à exclu', () => {
    expect(normaliserTauxEtRegime(NON, { tauxTvaPourmille: 0, regimeTva: 'reduit' })).toEqual({
      tauxTvaPourmille: 0,
      regimeTva: 'exclu',
    });
  });

  it('non assujetti : taux 81 refusé, TVA_NON_ASSUJETTI_TAUX_INTERDIT', () => {
    expect(() =>
      normaliserTauxEtRegime(NON, { tauxTvaPourmille: 81, regimeTva: 'normal' }, 3),
    ).toThrow(expect.objectContaining({ code: 'TVA_NON_ASSUJETTI_TAUX_INTERDIT' }));
  });

  it('assujetti : valeurs inchangées, taux absent reste null', () => {
    expect(normaliserTauxEtRegime(OUI, { tauxTvaPourmille: 26, regimeTva: 'reduit' })).toEqual({
      tauxTvaPourmille: 26,
      regimeTva: 'reduit',
    });
    expect(normaliserTauxEtRegime(OUI, { tauxTvaPourmille: null, regimeTva: 'normal' })).toEqual({
      tauxTvaPourmille: null,
      regimeTva: 'normal',
    });
  });
});
