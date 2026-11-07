import { describe, expect, it } from 'vitest';

import { doitOuvrirAutomatiquement } from './ouverture-assistant';

const BASE = { autorise: true, etatConnu: true, garageConfigure: false, ferme: false };

describe('doitOuvrirAutomatiquement', () => {
  it('garage neuf, droit, jamais fermé : ouvre', () => {
    expect(doitOuvrirAutomatiquement(BASE)).toBe(true);
  });
  it("sans le droit de gérer les paramètres : n'ouvre pas", () => {
    expect(doitOuvrirAutomatiquement({ ...BASE, autorise: false })).toBe(false);
  });
  it("état de démarrage pas encore connu : n'ouvre pas", () => {
    expect(doitOuvrirAutomatiquement({ ...BASE, etatConnu: false })).toBe(false);
  });
  it("garage déjà configuré : n'ouvre pas", () => {
    expect(doitOuvrirAutomatiquement({ ...BASE, garageConfigure: true })).toBe(false);
  });
  it("déjà fermé par cette personne : n'ouvre pas", () => {
    expect(doitOuvrirAutomatiquement({ ...BASE, ferme: true })).toBe(false);
  });
});
