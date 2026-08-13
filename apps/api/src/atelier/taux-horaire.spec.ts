import { describe, expect, it } from 'vitest';
import type { LigneTauxHoraire } from '../db/schema';
import { CODE_TAUX_HORAIRE_DEFAUT, resoudreTauxHorairePourDate } from './taux-horaire';

/**
 * Extrait de `service-ligne-or.ts::resoudreTauxHoraireCentimes` (#72), pour être réutilisé sans
 * accès base par la résolution d'une condition commerciale (`clients/service-client-sous-
 * collections.ts`). Ce fichier reprend les scénarios RM-65 déjà couverts indirectement par
 * `service-ligne-or.spec.ts` (via `ServiceLigneOr.creer`), MAIS teste ici la fonction PURE
 * directement, avec en plus `libelle`/`code` — jamais couverts avant #72, puisque
 * `exigerTauxHoraire` ne lisait que `.centimes`.
 */
function tauxHoraireFixture(overrides: Partial<LigneTauxHoraire> = {}): LigneTauxHoraire {
  return {
    id: 'th-1',
    tenantId: 'tid-1',
    code: CODE_TAUX_HORAIRE_DEFAUT,
    libelle: 'Taux horaire atelier',
    montantCentimes: 13_500,
    valideDu: '2020-01-01',
    valideAu: null,
    creeLe: new Date('2020-01-01T00:00:00.000Z'),
    modifieLe: new Date('2020-01-01T00:00:00.000Z'),
    ...overrides,
  } as LigneTauxHoraire;
}

describe('resoudreTauxHorairePourDate — cascade RM-65 (#72 : réutilisée à une date arbitraire, pas seulement « aujourd’hui »)', () => {
  it('un code client négocié qui couvre la date de référence prime, même si un taux standard existe aussi', () => {
    const resolution = resoudreTauxHorairePourDate(
      [
        tauxHoraireFixture(),
        tauxHoraireFixture({ id: 'th-2', code: 'FLOTTE', montantCentimes: 11_500 }),
      ],
      'FLOTTE',
      '2026-01-01',
    );
    expect(resolution).toMatchObject({
      code: 'FLOTTE',
      libelle: 'Taux horaire atelier',
      centimes: 11_500,
    });
  });

  it('un code client qui ne couvre PAS la date de référence échoue avec un motif — jamais rattrapé par le taux standard', () => {
    const resolution = resoudreTauxHorairePourDate(
      [
        tauxHoraireFixture(),
        tauxHoraireFixture({ id: 'th-2', code: 'FLOTTE', valideDu: '2026-06-01' }),
      ],
      'FLOTTE',
      '2026-01-01',
    );
    expect(resolution.centimes).toBeNull();
    if (resolution.centimes === null) {
      expect(resolution.motif).toContain('FLOTTE');
      expect(resolution.motif).toContain('2026-01-01');
    }
  });

  it('sans code client, retombe sur le taux STANDARD du garage (CODE_TAUX_HORAIRE_DEFAUT)', () => {
    const resolution = resoudreTauxHorairePourDate(
      [
        tauxHoraireFixture(),
        tauxHoraireFixture({ id: 'th-2', code: 'FLOTTE', montantCentimes: 11_500 }),
      ],
      null,
      '2026-01-01',
    );
    expect(resolution).toMatchObject({ code: CODE_TAUX_HORAIRE_DEFAUT, centimes: 13_500 });
  });

  it("sans code client ET sans taux standard, retombe sur l'UNIQUE taux du référentiel s'il n'y en a qu'un", () => {
    const resolution = resoudreTauxHorairePourDate(
      [tauxHoraireFixture({ code: 'MO', libelle: 'Main d’œuvre', montantCentimes: 12_000 })],
      null,
      '2026-01-01',
    );
    expect(resolution).toMatchObject({ code: 'MO', centimes: 12_000 });
  });

  it('sans code, sans standard, et PLUSIEURS taux distincts en vigueur : aucune résolution (ambigu), motif explicite', () => {
    const resolution = resoudreTauxHorairePourDate(
      [
        tauxHoraireFixture({ code: 'MO', montantCentimes: 12_000 }),
        tauxHoraireFixture({ id: 'th-2', code: 'FLOTTE', montantCentimes: 11_500 }),
      ],
      null,
      '2026-01-01',
    );
    expect(resolution.centimes).toBeNull();
  });

  it('borne haute EXCLUSIVE : une période qui se termine PILE à la date de référence ne couvre plus cette date (bascule tarifaire)', () => {
    const resolution = resoudreTauxHorairePourDate(
      [
        tauxHoraireFixture({
          valideDu: '2020-01-01',
          valideAu: '2026-01-01',
          montantCentimes: 10_000,
        }),
        tauxHoraireFixture({
          id: 'th-2',
          valideDu: '2026-01-01',
          valideAu: null,
          montantCentimes: 14_500,
        }),
      ],
      null,
      '2026-01-01',
    );
    // Le taux qui COMMENCE le 2026-01-01 est en vigueur ; celui qui FINIT ce jour-là ne l'est plus.
    expect(resolution).toMatchObject({ centimes: 14_500 });
  });

  it('résout À UNE DATE PASSÉE arbitraire (pas "aujourd’hui") — le point même de #72 : une condition commerciale résout à SA date valideDuLe, jamais à la date de lecture', () => {
    const resolution = resoudreTauxHorairePourDate(
      [
        tauxHoraireFixture({
          valideDu: '2015-01-01',
          valideAu: '2020-01-01',
          montantCentimes: 9_000,
        }),
        tauxHoraireFixture({
          id: 'th-2',
          valideDu: '2020-01-01',
          valideAu: null,
          montantCentimes: 13_500,
        }),
      ],
      null,
      '2017-06-15',
    );
    // Résolu au taux de 2015, alors que "aujourd'hui" (bien postérieur) verrait celui de 2020.
    expect(resolution).toMatchObject({ centimes: 9_000 });
  });
});
