import { describe, expect, it } from 'vitest';

import { ErreurMetier } from '../common/erreurs';

import { resoudrePeriodeTableauBord } from './periode';

/**
 * Bornes attendues en heure SUISSE (`Europe/Zurich`), pas UTC pur — voir la doc de tête de
 * `periode.ts` pour le défaut corrigé (14.08.2026) et `common/temps/fuseau-suisse.spec.ts` pour la
 * méthode de calcul indépendante des bascules d'été/hiver. Juillet/mai/août 2026 sont en CEST
 * (UTC+2, dernier dimanche de mars → dernier dimanche d'octobre) ; février/décembre en CET (UTC+1).
 */
describe('resoudrePeriodeTableauBord', () => {
  it('du et au explicites, en été (CEST, UTC+2) : bornes suisses dérivées exactement, jamais UTC pur', () => {
    const resultat = resoudrePeriodeTableauBord({ du: '2026-07-01', au: '2026-07-31' });

    expect(resultat.du).toBe('2026-07-01');
    expect(resultat.au).toBe('2026-07-31');
    // 00:00:00.000 heure suisse le 01.07 (CEST, +2h) = 30.06 22:00:00.000 UTC.
    expect(resultat.duDebutUtc.toISOString()).toBe('2026-06-30T22:00:00.000Z');
    // Borne haute EXCLUSIVE : 23:59:59.999 heure suisse le 31.07 (CEST) = 21:59:59.999 UTC, +1ms.
    expect(resultat.auFinExclusiveUtc.toISOString()).toBe('2026-07-31T22:00:00.000Z');
  });

  it('du et au absents, en été : mois civil SUISSE courant, du 1er du mois à aujourd’hui inclus, bornes suisses', () => {
    const maintenant = new Date('2026-08-04T15:30:00.000Z');

    const resultat = resoudrePeriodeTableauBord({}, maintenant);

    expect(resultat.du).toBe('2026-08-01');
    expect(resultat.au).toBe('2026-08-04');
    expect(resultat.duDebutUtc.toISOString()).toBe('2026-07-31T22:00:00.000Z');
    expect(resultat.auFinExclusiveUtc.toISOString()).toBe('2026-08-04T22:00:00.000Z');
  });

  it("le bug mesuré le 14.08.2026 : un OR ouvert à 00h30 heure suisse (donc 22h30 UTC LA VEILLE, CEST) appartient bien à « aujourd'hui » suisse, pas à hier — la fenêtre UTC pure l'aurait exclu", () => {
    // 00h30 heure suisse le 14.08.2026 (CEST, +2h) == 2026-08-13T22:30:00.000Z en UTC. L'ancienne
    // borne UTC pure `[2026-08-14T00:00:00.000Z, ...)` aurait EXCLU cet instant (antérieur à la
    // borne basse), le rangeant à tort dans la journée du 13 — exactement le défaut qui pouvait
    // faire disparaître un OR pourtant ouvert « aujourd'hui » côté horloge suisse.
    const resultat = resoudrePeriodeTableauBord({ du: '2026-08-14', au: '2026-08-14' });
    const instantOr = new Date('2026-08-13T22:30:00.000Z');

    expect(instantOr.getTime()).toBeGreaterThanOrEqual(resultat.duDebutUtc.getTime());
    expect(instantOr.getTime()).toBeLessThan(resultat.auFinExclusiveUtc.getTime());
  });

  it('le 1er du mois : du = au = aujourd’hui (aucune journée avant n’existe dans le mois)', () => {
    const maintenant = new Date('2026-03-01T09:00:00.000Z');

    const resultat = resoudrePeriodeTableauBord({}, maintenant);

    expect(resultat.du).toBe('2026-03-01');
    expect(resultat.au).toBe('2026-03-01');
  });

  it('au explicite le dernier jour d’un mois, en hiver (CET, UTC+1) : la borne exclusive franchit correctement au mois suivant', () => {
    const resultat = resoudrePeriodeTableauBord({ du: '2026-02-01', au: '2026-02-28' });

    // 23:59:59.999 heure suisse le 28.02 (CET, +1h) = 22:59:59.999 UTC, +1ms.
    expect(resultat.auFinExclusiveUtc.toISOString()).toBe('2026-02-28T23:00:00.000Z');
  });

  it('31 décembre, en hiver : la borne exclusive franchit correctement l’année en heure suisse', () => {
    const resultat = resoudrePeriodeTableauBord({ du: '2026-12-01', au: '2026-12-31' });

    // 23:59:59.999 heure suisse le 31.12 (CET, +1h) = 22:59:59.999 UTC le 31.12, +1ms — reste le
    // 31.12 EN UTC (contrairement à la borne UTC pure d'avant ce correctif, qui franchissait déjà
    // l'année) : l'heure suisse est TOUJOURS en avance sur UTC, jamais en retard.
    expect(resultat.auFinExclusiveUtc.toISOString()).toBe('2026-12-31T23:00:00.000Z');
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

  it('du === au (une seule journée), en été : accepté, bornes suisses couvrant exactement ce jour', () => {
    const resultat = resoudrePeriodeTableauBord({ du: '2026-05-10', au: '2026-05-10' });

    // Mai 2026 est déjà en CEST (bascule le 29.03) : +2h sur UTC des deux côtés.
    expect(resultat.duDebutUtc.toISOString()).toBe('2026-05-09T22:00:00.000Z');
    expect(resultat.auFinExclusiveUtc.toISOString()).toBe('2026-05-10T22:00:00.000Z');
  });
});
