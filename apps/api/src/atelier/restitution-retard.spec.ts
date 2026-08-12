import { describe, expect, it } from 'vitest';

import { estRestitutionEnRetard } from './restitution-retard';

const MAINTENANT = new Date('2026-08-12T14:00:00.000Z');

describe('estRestitutionEnRetard — le cœur du chantier RDV', () => {
  it('rend false quand restitutionPromiseLe est absent, quel que soit le statut — une date promise absente n’est JAMAIS un retard', () => {
    expect(
      estRestitutionEnRetard({ statut: 'ouvert', restitutionPromiseLe: null }, MAINTENANT),
    ).toBe(false);
    expect(
      estRestitutionEnRetard({ statut: 'en_cours', restitutionPromiseLe: null }, MAINTENANT),
    ).toBe(false);
  });

  it('rend true quand la promesse est dépassée et l’OR encore actif', () => {
    const promesseDepassee = new Date('2026-08-12T10:00:00.000Z');
    expect(
      estRestitutionEnRetard(
        { statut: 'en_cours', restitutionPromiseLe: promesseDepassee },
        MAINTENANT,
      ),
    ).toBe(true);
  });

  it('rend false quand la promesse n’est pas encore atteinte', () => {
    const promesseFuture = new Date('2026-08-12T18:00:00.000Z');
    expect(
      estRestitutionEnRetard(
        { statut: 'ouvert', restitutionPromiseLe: promesseFuture },
        MAINTENANT,
      ),
    ).toBe(false);
  });

  it('rend false pile à l’instant de la promesse (strictement après, pas à l’égalité)', () => {
    expect(
      estRestitutionEnRetard({ statut: 'ouvert', restitutionPromiseLe: MAINTENANT }, MAINTENANT),
    ).toBe(false);
  });

  for (const statutTerminal of ['restitue', 'cloture', 'annule'] as const) {
    it(`rend false pour le statut terminal "${statutTerminal}", même avec une promesse largement dépassée`, () => {
      const promesseDepassee = new Date('2026-01-01T00:00:00.000Z');
      expect(
        estRestitutionEnRetard(
          { statut: statutTerminal, restitutionPromiseLe: promesseDepassee },
          MAINTENANT,
        ),
      ).toBe(false);
    });
  }

  it('rend true pour les statuts actifs restants (planifie, controle, termine, facture)', () => {
    const promesseDepassee = new Date('2026-01-01T00:00:00.000Z');
    for (const statut of ['planifie', 'controle', 'termine', 'facture'] as const) {
      expect(
        estRestitutionEnRetard({ statut, restitutionPromiseLe: promesseDepassee }, MAINTENANT),
      ).toBe(true);
    }
  });
});
