import { describe, expect, it } from 'vitest';

import type { ReponsePointage } from '@dfa/shared';

import { calculerCumulSecondesCible, cibleCumulDepuisPointage } from './cumul-cible-jour';

function construirePointage(overrides: Partial<ReponsePointage> = {}): ReponsePointage {
  return {
    id: 'pointage-1',
    siteId: 'site-1',
    technicienId: 'technicien-1',
    technicienNomAffiche: 'Jean Dupont',
    statut: 'termine',
    nature: 'productif_ligne',
    ordreReparationId: 'or-1',
    ordreReparationNumero: 'OR-000123',
    ligneOrId: 'ligne-1',
    ligneOrDesignation: 'Vidange',
    activiteIndirecte: null,
    source: 'ecran_atelier',
    appareilId: null,
    debutLe: '2026-08-14T06:00:00.000Z',
    finLe: '2026-08-14T06:30:00.000Z',
    dureeBruteSecondes: 1800,
    dureeArrondieCentiemes: null,
    clotureAutomatique: false,
    anomalie: null,
    derniereCorrection: null,
    creeLe: '2026-08-14T06:00:00.000Z',
    modifieLe: '2026-08-14T06:30:00.000Z',
    ...overrides,
  };
}

describe('calculerCumulSecondesCible', () => {
  it('retourne 0 en l’absence de tout segment antérieur sur la cible — première visite du jour', () => {
    const cible = {
      nature: 'productif_ligne' as const,
      ordreReparationId: 'or-1',
      ligneOrId: 'ligne-1',
    };

    expect(calculerCumulSecondesCible([], cible)).toBe(0);
  });

  it('somme les segments antérieurs correspondant EXACTEMENT à la cible (même ligne)', () => {
    const cible = {
      nature: 'productif_ligne' as const,
      ordreReparationId: 'or-1',
      ligneOrId: 'ligne-1',
    };
    const pointages = [
      construirePointage({ id: 'p1', dureeBruteSecondes: 1800 }),
      construirePointage({ id: 'p2', dureeBruteSecondes: 900 }),
    ];

    expect(calculerCumulSecondesCible(pointages, cible)).toBe(2700);
  });

  it('ignore un pointage encore `en_cours` (`dureeBruteSecondes: null`) — jamais compté deux fois avec le chrono live', () => {
    const cible = {
      nature: 'productif_ligne' as const,
      ordreReparationId: 'or-1',
      ligneOrId: 'ligne-1',
    };
    const pointages = [
      construirePointage({ id: 'p1', dureeBruteSecondes: 1800 }),
      construirePointage({ id: 'p2', statut: 'en_cours', dureeBruteSecondes: null }),
    ];

    expect(calculerCumulSecondesCible(pointages, cible)).toBe(1800);
  });

  it('ignore un segment sur une AUTRE ligne du même OR', () => {
    const cible = {
      nature: 'productif_ligne' as const,
      ordreReparationId: 'or-1',
      ligneOrId: 'ligne-1',
    };
    const pointages = [
      construirePointage({ id: 'p1', ligneOrId: 'ligne-2', dureeBruteSecondes: 1800 }),
    ];

    expect(calculerCumulSecondesCible(pointages, cible)).toBe(0);
  });

  it('distingue `productif_or` (OR entier) de `productif_ligne` sur le même OR', () => {
    const cible = { nature: 'productif_or' as const, ordreReparationId: 'or-1' };
    const pointages = [
      construirePointage({ id: 'p1', nature: 'productif_ligne', dureeBruteSecondes: 1800 }),
      construirePointage({
        id: 'p2',
        nature: 'productif_or',
        ligneOrId: null,
        dureeBruteSecondes: 600,
      }),
    ];

    expect(calculerCumulSecondesCible(pointages, cible)).toBe(600);
  });

  it('cumule une activité indirecte par son type (`activiteIndirecte`), pas par OR', () => {
    const cible = { nature: 'indirect' as const, activiteIndirecte: 'nettoyage' as const };
    const pointages = [
      construirePointage({
        id: 'p1',
        nature: 'indirect',
        ordreReparationId: null,
        ligneOrId: null,
        activiteIndirecte: 'nettoyage',
        dureeBruteSecondes: 300,
      }),
      construirePointage({
        id: 'p2',
        nature: 'indirect',
        ordreReparationId: null,
        ligneOrId: null,
        activiteIndirecte: 'pause',
        dureeBruteSecondes: 900,
      }),
    ];

    expect(calculerCumulSecondesCible(pointages, cible)).toBe(300);
  });
});

describe('cibleCumulDepuisPointage', () => {
  it('dérive une cible `productif_ligne` depuis un pointage sur une ligne', () => {
    const pointage = construirePointage();

    expect(cibleCumulDepuisPointage(pointage)).toEqual({
      nature: 'productif_ligne',
      ordreReparationId: 'or-1',
      ligneOrId: 'ligne-1',
    });
  });

  it('dérive une cible `productif_or` depuis un pointage sur un OR entier', () => {
    const pointage = construirePointage({ nature: 'productif_or', ligneOrId: null });

    expect(cibleCumulDepuisPointage(pointage)).toEqual({
      nature: 'productif_or',
      ordreReparationId: 'or-1',
    });
  });

  it('dérive une cible `indirect` depuis une activité indirecte', () => {
    const pointage = construirePointage({
      nature: 'indirect',
      ordreReparationId: null,
      ligneOrId: null,
      activiteIndirecte: 'pause',
    });

    expect(cibleCumulDepuisPointage(pointage)).toEqual({
      nature: 'indirect',
      activiteIndirecte: 'pause',
    });
  });
});
