import { describe, expect, it } from 'vitest';

import type { OrdreReparationResume } from '@dfa/shared';

import { trouverOrPrecedent } from './or-precedent';

function or(id: string, ouvertLe: string | null): OrdreReparationResume {
  return { id, numero: id, ouvertLe } as unknown as OrdreReparationResume;
}

describe('trouverOrPrecedent', () => {
  const liste = [
    or('c', '2026-03-01T08:00:00Z'),
    or('b', '2026-02-01T08:00:00Z'),
    or('a', '2026-01-01T08:00:00Z'),
  ];

  it('rend l’OR ouvert juste AVANT celui affiché, pas le plus récent', () => {
    expect(trouverOrPrecedent(liste, { id: 'b', ouvertLe: '2026-02-01T08:00:00Z' })?.id).toBe('a');
  });

  it('rend null pour le plus ancien', () => {
    expect(trouverOrPrecedent(liste, { id: 'a', ouvertLe: '2026-01-01T08:00:00Z' })).toBeNull();
  });

  it('un OR planifié (sans date d’ouverture) est précédé du plus récent OR ouvert', () => {
    expect(trouverOrPrecedent(liste, { id: 'z', ouvertLe: null })?.id).toBe('c');
  });
});
