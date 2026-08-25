import { describe, expect, it } from 'vitest';
import type { StatutDossierReprise } from '@dfa/shared';
import { STATUTS_DOSSIER_REPRISE } from '@dfa/shared';

import { annulationRecevable, transitionAutorisee } from './transitions-dossier-reprise';

describe('transitionAutorisee', () => {
  it('accepte les transitions du diagramme gelé (contrats/reprise.ts)', () => {
    expect(transitionAutorisee('depot_en_cours', 'depot_receptionne')).toBe(true);
    expect(transitionAutorisee('depot_receptionne', 'analyse_en_cours')).toBe(true);
    expect(transitionAutorisee('analyse_en_cours', 'analyse_terminee')).toBe(true);
    expect(transitionAutorisee('analyse_en_cours', 'analyse_echouee')).toBe(true);
    expect(transitionAutorisee('analyse_echouee', 'analyse_en_cours')).toBe(true);
    expect(transitionAutorisee('analyse_terminee', 'plan_propose')).toBe(true);
    expect(transitionAutorisee('plan_propose', 'plan_valide')).toBe(true);
    expect(transitionAutorisee('plan_valide', 'import_en_cours')).toBe(true);
    expect(transitionAutorisee('import_en_cours', 'import_termine')).toBe(true);
    expect(transitionAutorisee('import_en_cours', 'import_echoue')).toBe(true);
    expect(transitionAutorisee('import_echoue', 'import_en_cours')).toBe(true);
  });

  it('refuse de sauter des états (ex. depot_en_cours -> analyse_en_cours directement)', () => {
    expect(transitionAutorisee('depot_en_cours', 'analyse_en_cours')).toBe(false);
    expect(transitionAutorisee('depot_receptionne', 'plan_propose')).toBe(false);
    expect(transitionAutorisee('plan_propose', 'import_en_cours')).toBe(false);
  });

  it('refuse toute transition depuis un état terminal (import_termine, annule)', () => {
    for (const cible of STATUTS_DOSSIER_REPRISE) {
      expect(transitionAutorisee('import_termine', cible)).toBe(false);
      expect(transitionAutorisee('annule', cible)).toBe(false);
    }
  });

  it('refuse une transition vers soi-même (aucun état ne se boucle)', () => {
    for (const statut of STATUTS_DOSSIER_REPRISE) {
      expect(transitionAutorisee(statut, statut)).toBe(false);
    }
  });
});

describe('annulationRecevable', () => {
  const NON_TERMINAUX: readonly StatutDossierReprise[] = [
    'depot_en_cours',
    'depot_receptionne',
    'analyse_en_cours',
    'analyse_echouee',
    'analyse_terminee',
    'plan_propose',
    'plan_valide',
    'import_en_cours',
    'import_echoue',
  ];

  it('recevable depuis tout état NON terminal', () => {
    for (const statut of NON_TERMINAUX) {
      expect(annulationRecevable(statut)).toBe(true);
    }
  });

  it('refusée depuis les deux états terminaux (import_termine, annule)', () => {
    expect(annulationRecevable('import_termine')).toBe(false);
    expect(annulationRecevable('annule')).toBe(false);
  });
});
