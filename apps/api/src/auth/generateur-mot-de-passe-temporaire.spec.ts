import { describe, expect, it } from 'vitest';
import { genererMotDePasseTemporaire } from './generateur-mot-de-passe-temporaire';

describe('genererMotDePasseTemporaire', () => {
  it('rend une chaîne non vide, suffisamment longue (haute entropie sans règle de complexité à valider)', () => {
    const mdp = genererMotDePasseTemporaire();
    expect(typeof mdp).toBe('string');
    expect(mdp.length).toBeGreaterThanOrEqual(20);
  });

  it("n'est jamais deux fois la même valeur (tiré du CSPRNG, pas d'un motif figé)", () => {
    const valeurs = new Set(Array.from({ length: 50 }, () => genererMotDePasseTemporaire()));
    expect(valeurs.size).toBe(50);
  });

  it('ne contient que des caractères base64url (jamais de séparateur ambigu à recopier oralement)', () => {
    const mdp = genererMotDePasseTemporaire();
    expect(mdp).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
