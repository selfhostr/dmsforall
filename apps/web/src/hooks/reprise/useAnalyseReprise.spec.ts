import { describe, expect, it } from 'vitest';

import type { ReponseAnalyseReprise } from '@dfa/shared';

import { calculerIntervalleSondageAnalyse } from './useAnalyseReprise';

function analyse(partiel: Partial<ReponseAnalyseReprise> = {}): ReponseAnalyseReprise {
  return {
    id: 'analyse-1',
    dossierRepriseId: 'dossier-1',
    statut: 'en_cours',
    partielle: false,
    moteurDetecte: { famille: 'inconnu', indiceConfiance: 0 },
    fichiers: [],
    tables: [],
    anomalies: [],
    demarreeLe: null,
    termineeLe: null,
    ...partiel,
  };
}

describe('calculerIntervalleSondageAnalyse — le sondage s’arrête à l’état terminal', () => {
  it('aucune analyse -> sondage arrêté', () => {
    expect(calculerIntervalleSondageAnalyse(undefined)).toBe(false);
  });

  it('analyse en_cours -> sondage actif toutes les 5 s', () => {
    expect(calculerIntervalleSondageAnalyse(analyse({ statut: 'en_cours' }))).toBe(5_000);
  });

  it('analyse terminee -> sondage arrêté', () => {
    expect(calculerIntervalleSondageAnalyse(analyse({ statut: 'terminee' }))).toBe(false);
  });

  it('analyse echouee -> sondage arrêté (une relance explicite est requise, pas un sondage)', () => {
    expect(calculerIntervalleSondageAnalyse(analyse({ statut: 'echouee' }))).toBe(false);
  });
});
