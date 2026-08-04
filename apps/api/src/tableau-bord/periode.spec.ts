import { describe, expect, it } from 'vitest';

import { ErreurMetier } from '../common/erreurs';

import { resoudrePeriodeTableauBord } from './periode';

describe('resoudrePeriodeTableauBord', () => {
  it('du et au explicites : renvoyés tels quels, bornes UTC dérivées exactement', () => {
    const resultat = resoudrePeriodeTableauBord({ du: '2026-07-01', au: '2026-07-31' });

    expect(resultat.du).toBe('2026-07-01');
    expect(resultat.au).toBe('2026-07-31');
    expect(resultat.duDebutUtc.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    // Borne haute EXCLUSIVE : un jour après `au`, pour inclure toute la journée du 31.
    expect(resultat.auFinExclusiveUtc.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('du et au absents : mois civil UTC courant, du 1er du mois à aujourd’hui inclus', () => {
    const maintenant = new Date('2026-08-04T15:30:00.000Z');

    const resultat = resoudrePeriodeTableauBord({}, maintenant);

    expect(resultat.du).toBe('2026-08-01');
    expect(resultat.au).toBe('2026-08-04');
    expect(resultat.duDebutUtc.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(resultat.auFinExclusiveUtc.toISOString()).toBe('2026-08-05T00:00:00.000Z');
  });

  it('le 1er du mois : du = au = aujourd’hui (aucune journée avant n’existe dans le mois)', () => {
    const maintenant = new Date('2026-03-01T09:00:00.000Z');

    const resultat = resoudrePeriodeTableauBord({}, maintenant);

    expect(resultat.du).toBe('2026-03-01');
    expect(resultat.au).toBe('2026-03-01');
  });

  it('au explicite le dernier jour d’un mois : la borne exclusive franchit correctement au mois suivant', () => {
    const resultat = resoudrePeriodeTableauBord({ du: '2026-02-01', au: '2026-02-28' });

    expect(resultat.auFinExclusiveUtc.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('31 décembre : la borne exclusive franchit correctement l’année', () => {
    const resultat = resoudrePeriodeTableauBord({ du: '2026-12-01', au: '2026-12-31' });

    expect(resultat.auFinExclusiveUtc.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('seul `du` fourni : `au` par défaut = aujourd’hui', () => {
    const maintenant = new Date('2026-08-04T00:00:00.000Z');

    const resultat = resoudrePeriodeTableauBord({ du: '2026-06-15' }, maintenant);

    expect(resultat.du).toBe('2026-06-15');
    expect(resultat.au).toBe('2026-08-04');
  });

  it('seul `au` fourni : `du` par défaut = 1er du mois courant', () => {
    const maintenant = new Date('2026-08-20T00:00:00.000Z');

    const resultat = resoudrePeriodeTableauBord({ au: '2026-08-10' }, maintenant);

    expect(resultat.du).toBe('2026-08-01');
    expect(resultat.au).toBe('2026-08-10');
  });

  it('`au` seul, dans un mois antérieur au mois courant : `du` par défaut (1er du mois courant) serait postérieur à `au` — rejeté plutôt que renvoyé inversé', () => {
    const maintenant = new Date('2026-08-20T00:00:00.000Z');

    expect(() => resoudrePeriodeTableauBord({ au: '2026-01-15' }, maintenant)).toThrow(
      ErreurMetier,
    );
    try {
      resoudrePeriodeTableauBord({ au: '2026-01-15' }, maintenant);
      expect.unreachable('devait lever ErreurMetier');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurMetier);
      expect((erreur as ErreurMetier).code).toBe('VALIDATION_ECHOUEE');
      expect((erreur as ErreurMetier).status).toBe(400);
    }
  });

  it('du === au (une seule journée) : accepté, bornes UTC couvrant exactement ce jour', () => {
    const resultat = resoudrePeriodeTableauBord({ du: '2026-05-10', au: '2026-05-10' });

    expect(resultat.duDebutUtc.toISOString()).toBe('2026-05-10T00:00:00.000Z');
    expect(resultat.auFinExclusiveUtc.toISOString()).toBe('2026-05-11T00:00:00.000Z');
  });
});
