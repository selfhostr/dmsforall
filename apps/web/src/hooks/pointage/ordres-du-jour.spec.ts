import { describe, expect, it } from 'vitest';

import type { ReponseOrdreReparation } from '@dfa/shared';

import { estHorsSite, trierParEcheance } from './ordres-du-jour';

function or(numero: string, restitutionPromiseLe: string | null, siteId = 's1') {
  return { id: numero, numero, restitutionPromiseLe, siteId } as unknown as ReponseOrdreReparation;
}

describe('trierParEcheance', () => {
  it('range la plus proche échéance d’abord, les OR sans promesse à la fin', () => {
    const tries = trierParEcheance([
      or('OR-2026-1', null),
      or('OR-2026-2', '2026-11-07T16:00:00.000Z'),
      or('OR-2026-3', '2026-11-06T09:00:00.000Z'),
      or('OR-2026-10', null),
    ]);
    expect(tries.map((o) => o.numero)).toEqual([
      'OR-2026-3',
      'OR-2026-2',
      'OR-2026-1',
      'OR-2026-10',
    ]);
  });

  it('ne modifie pas le tableau reçu', () => {
    const source = [or('B', null), or('A', '2026-11-07T10:00:00.000Z')];
    trierParEcheance(source);
    expect(source.map((o) => o.numero)).toEqual(['B', 'A']);
  });
});

describe('estHorsSite', () => {
  it('est faux sans site de borne (compte de personne)', () => {
    expect(estHorsSite(or('A', null, 's2'), undefined)).toBe(false);
  });
  it('est vrai pour un autre site que celui de la borne, faux pour le sien', () => {
    expect(estHorsSite(or('A', null, 's2'), 's1')).toBe(true);
    expect(estHorsSite(or('A', null, 's1'), 's1')).toBe(false);
  });
});
