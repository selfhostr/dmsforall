import { describe, expect, it } from 'vitest';
import { schemaModificationParametresAtelierEtendu } from './schema-modification-parametres-atelier-etendu';

/**
 * `RF-117` (0018) : `reception.plafondAvoirReceptionnaireCentimes` — mêmes bornes que le `CHECK`
 * SQL posé par la migration (`is null or between 0 and 100000000`). Ce fichier ne teste QUE ce
 * qui est ajouté par l'extension locale ; le reste du schéma (`or`, `travaux`, …) est déjà couvert
 * indirectement par les tests existants de `service-parametres-atelier.spec.ts` /
 * `gouvernance-fonctionnalites.spec.ts`, qui passent par ce même schéma en intégration du pipe.
 */
describe('schemaModificationParametresAtelierEtendu — reception.plafondAvoirReceptionnaireCentimes', () => {
  it('accepte une valeur nominale positive', () => {
    const resultat = schemaModificationParametresAtelierEtendu.safeParse({
      reception: { plafondAvoirReceptionnaireCentimes: 500000 },
    });
    expect(resultat.success).toBe(true);
    if (resultat.success) {
      expect(resultat.data.reception?.plafondAvoirReceptionnaireCentimes).toBe(500000);
    }
  });

  it('accepte `null` — remet « aucun plafond convenu » (RF-117, dégradé documenté)', () => {
    const resultat = schemaModificationParametresAtelierEtendu.safeParse({
      reception: { plafondAvoirReceptionnaireCentimes: null },
    });
    expect(resultat.success).toBe(true);
    if (resultat.success) {
      expect(resultat.data.reception?.plafondAvoirReceptionnaireCentimes).toBeNull();
    }
  });

  it('accepte `0` — distinct de `null` (« toute émission par un réceptionnaire doit escalader »)', () => {
    const resultat = schemaModificationParametresAtelierEtendu.safeParse({
      reception: { plafondAvoirReceptionnaireCentimes: 0 },
    });
    expect(resultat.success).toBe(true);
    if (resultat.success) {
      expect(resultat.data.reception?.plafondAvoirReceptionnaireCentimes).toBe(0);
    }
  });

  it('champ omis : absent du résultat (ne force pas la colonne à undefined)', () => {
    const resultat = schemaModificationParametresAtelierEtendu.safeParse({
      reception: { kmEntreeObligatoire: true },
    });
    expect(resultat.success).toBe(true);
    if (resultat.success) {
      expect('plafondAvoirReceptionnaireCentimes' in (resultat.data.reception ?? {})).toBe(false);
    }
  });

  it('refuse une valeur négative, avant toute atteinte de la base', () => {
    const resultat = schemaModificationParametresAtelierEtendu.safeParse({
      reception: { plafondAvoirReceptionnaireCentimes: -1 },
    });
    expect(resultat.success).toBe(false);
  });

  it("refuse une valeur au-delà de la borne haute du CHECK SQL (100'000'000 centimes)", () => {
    const resultat = schemaModificationParametresAtelierEtendu.safeParse({
      reception: { plafondAvoirReceptionnaireCentimes: 100_000_001 },
    });
    expect(resultat.success).toBe(false);
  });

  it("accepte exactement la borne haute (100'000'000 centimes = CHF 1'000'000.-)", () => {
    const resultat = schemaModificationParametresAtelierEtendu.safeParse({
      reception: { plafondAvoirReceptionnaireCentimes: 100_000_000 },
    });
    expect(resultat.success).toBe(true);
  });

  it('refuse une valeur non entière (centimes, jamais de float)', () => {
    const resultat = schemaModificationParametresAtelierEtendu.safeParse({
      reception: { plafondAvoirReceptionnaireCentimes: 100.5 },
    });
    expect(resultat.success).toBe(false);
  });

  it('le reste du schéma gelé (ex. or.prefixe) reste validé normalement', () => {
    const resultat = schemaModificationParametresAtelierEtendu.safeParse({ or: { prefixe: 'OR' } });
    expect(resultat.success).toBe(true);
  });
});
