import { describe, expect, it } from 'vitest';

import type { ReponseImportReprise } from '@dfa/shared';

import { calculerIntervalleSondageImport } from './useImportReprise';

function imp(partiel: Partial<ReponseImportReprise> = {}): ReponseImportReprise {
  return {
    id: 'import-1',
    dossierRepriseId: 'dossier-1',
    planId: 'plan-1',
    statut: 'en_cours',
    domaineCourant: null,
    progression: { elementsTraites: 0, elementsTotal: 0 },
    tentative: 1,
    demarreLe: null,
    termineLe: null,
    ...partiel,
  };
}

describe('calculerIntervalleSondageImport — le sondage s’arrête à l’état terminal', () => {
  it('aucun import -> sondage arrêté', () => {
    expect(calculerIntervalleSondageImport(undefined)).toBe(false);
  });

  it.each(['en_attente', 'en_cours'] as const)(
    'import %s -> sondage actif toutes les 3 s',
    (statut) => {
      expect(calculerIntervalleSondageImport(imp({ statut }))).toBe(3_000);
    },
  );

  it.each(['termine', 'echoue', 'annule'] as const)('import %s -> sondage arrêté', (statut) => {
    expect(calculerIntervalleSondageImport(imp({ statut }))).toBe(false);
  });
});
