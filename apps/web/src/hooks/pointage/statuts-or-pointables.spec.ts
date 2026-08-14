import { describe, expect, it } from 'vitest';

import { statutOrPointable } from './statuts-or-pointables';

// Même partition que `estOrPointable` côté serveur (`apps/api/src/pointage/regles-pointage.spec.ts`,
// `describe('estOrPointable (RM-92)')`) — les deux DOIVENT rester identiques, voir la docstring de
// `statuts-or-pointables.ts` sur la duplication assumée.
describe('statutOrPointable', () => {
  it.each(['planifie', 'ouvert', 'en_cours', 'controle'] as const)(
    '%s reste pointable',
    (statut) => {
      expect(statutOrPointable(statut)).toBe(true);
    },
  );

  it.each(['termine', 'facture', 'restitue', 'cloture', 'annule'] as const)(
    '%s n’est plus pointable',
    (statut) => {
      expect(statutOrPointable(statut)).toBe(false);
    },
  );
});
