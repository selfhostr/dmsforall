import { describe, expect, it } from 'vitest';

import {
  calculerDateEcheance,
  calculerRetardDocument,
  lireDelaiPaiementJoursFige,
} from './echeance';

describe('lireDelaiPaiementJoursFige — lecture tolérante du JSONB opaque conditions_paiement_figees', () => {
  it('lit un entier positif', () => {
    expect(lireDelaiPaiementJoursFige({ delaiPaiementJours: 30 })).toBe(30);
  });

  it('accepte 0 (payable à réception) — valeur légitime, pas confondue avec absente', () => {
    expect(lireDelaiPaiementJoursFige({ delaiPaiementJours: 0 })).toBe(0);
  });

  it('rend null quand le champ est absent (client sans conditions en vigueur, {} figé)', () => {
    expect(lireDelaiPaiementJoursFige({})).toBeNull();
  });

  it('rend null pour conditionsPaiementFigees null', () => {
    expect(lireDelaiPaiementJoursFige(null)).toBeNull();
  });

  it('rend null pour un entier négatif (donnée corrompue) — jamais une échéance fabriquée', () => {
    expect(lireDelaiPaiementJoursFige({ delaiPaiementJours: -5 })).toBeNull();
  });

  it('rend null pour une valeur non entière', () => {
    expect(lireDelaiPaiementJoursFige({ delaiPaiementJours: 30.5 })).toBeNull();
  });

  it('rend null pour une valeur non numérique (texte libre éventuel)', () => {
    expect(lireDelaiPaiementJoursFige({ delaiPaiementJours: 'net 30' })).toBeNull();
  });

  it('rend null pour un tableau (forme JSONB inattendue)', () => {
    expect(lireDelaiPaiementJoursFige([{ delaiPaiementJours: 30 }])).toBeNull();
  });
});

describe('calculerDateEcheance — dateDocument + délai en jours CALENDAIRES', () => {
  it('30 jours nets, sans franchissement de mois', () => {
    expect(calculerDateEcheance('2026-08-01', 30)).toBe('2026-08-31');
  });

  it('délai franchissant un mois', () => {
    expect(calculerDateEcheance('2026-08-15', 30)).toBe('2026-09-14');
  });

  it('délai franchissant une année', () => {
    expect(calculerDateEcheance('2026-12-15', 30)).toBe('2027-01-14');
  });

  it('délai franchissant une année bissextile (2028, 29 février)', () => {
    expect(calculerDateEcheance('2028-02-01', 29)).toBe('2028-03-01');
  });

  it('délai 0 (payable à réception) : échéance = date du document elle-même', () => {
    expect(calculerDateEcheance('2026-08-04', 0)).toBe('2026-08-04');
  });

  it('délai null : aucune échéance calculée', () => {
    expect(calculerDateEcheance('2026-08-04', null)).toBeNull();
  });
});

describe('calculerRetardDocument — colonne « Retard » de la liste des factures', () => {
  const MAINTENANT = new Date('2026-08-04T15:00:00.000Z');

  it('facture soldée (soldeCentimes = 0) : jamais en retard, même échéance largement dépassée', () => {
    expect(
      calculerRetardDocument({
        dateEcheance: '2026-01-01',
        soldeCentimes: 0,
        maintenant: MAINTENANT,
      }),
    ).toEqual({ enRetard: false, joursRetard: null });
  });

  it('échue et non soldée : en retard, jours de retard exacts', () => {
    expect(
      calculerRetardDocument({
        dateEcheance: '2026-07-25',
        soldeCentimes: 12_000,
        maintenant: MAINTENANT,
      }),
    ).toEqual({ enRetard: true, joursRetard: 10 });
  });

  it('échéance future et non soldée : pas encore en retard', () => {
    expect(
      calculerRetardDocument({
        dateEcheance: '2026-08-31',
        soldeCentimes: 12_000,
        maintenant: MAINTENANT,
      }),
    ).toEqual({ enRetard: false, joursRetard: null });
  });

  it("échéance exactement aujourd'hui : pas encore en retard (comparaison stricte)", () => {
    expect(
      calculerRetardDocument({
        dateEcheance: '2026-08-04',
        soldeCentimes: 12_000,
        maintenant: MAINTENANT,
      }),
    ).toEqual({ enRetard: false, joursRetard: null });
  });

  it('aucune échéance connue (dateEcheance null) : jamais en retard, même non soldée', () => {
    expect(
      calculerRetardDocument({ dateEcheance: null, soldeCentimes: 12_000, maintenant: MAINTENANT }),
    ).toEqual({ enRetard: false, joursRetard: null });
  });

  it('solde négatif (ne devrait jamais arriver, RF-67) : traité comme soldé, jamais en retard', () => {
    expect(
      calculerRetardDocument({
        dateEcheance: '2026-07-01',
        soldeCentimes: -100,
        maintenant: MAINTENANT,
      }),
    ).toEqual({ enRetard: false, joursRetard: null });
  });
});
