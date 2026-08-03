import { describe, expect, it } from 'vitest';
import { calculerEmpreinte } from './empreinte';

describe('calculerEmpreinte', () => {
  it('produit la même empreinte pour deux objets aux mêmes paires clé/valeur, ordre différent', () => {
    const a = calculerEmpreinte({ nom: 'Dupont', prenom: 'Jean', age: 40 });
    const b = calculerEmpreinte({ age: 40, prenom: 'Jean', nom: 'Dupont' });
    expect(a.equals(b)).toBe(true);
  });

  it('trie récursivement les objets imbriqués', () => {
    const a = calculerEmpreinte({ client: { nom: 'A', id: '1' }, montant: 100 });
    const b = calculerEmpreinte({ montant: 100, client: { id: '1', nom: 'A' } });
    expect(a.equals(b)).toBe(true);
  });

  it('produit une empreinte différente si une valeur change', () => {
    const a = calculerEmpreinte({ montant: 100 });
    const b = calculerEmpreinte({ montant: 101 });
    expect(a.equals(b)).toBe(false);
  });

  it("préserve l'ordre des tableaux : deux ordres différents produisent des empreintes différentes", () => {
    const a = calculerEmpreinte({ lignes: ['x', 'y'] });
    const b = calculerEmpreinte({ lignes: ['y', 'x'] });
    expect(a.equals(b)).toBe(false);
  });

  it("un tableau d'objets trie chaque objet mais garde l'ordre du tableau", () => {
    const a = calculerEmpreinte({ lignes: [{ b: 1, a: 2 }] });
    const b = calculerEmpreinte({ lignes: [{ a: 2, b: 1 }] });
    expect(a.equals(b)).toBe(true);
  });

  it('ignore les clés dont la valeur est undefined, comme JSON.stringify', () => {
    const a = calculerEmpreinte({ x: 1, y: undefined });
    const b = calculerEmpreinte({ x: 1 });
    expect(a.equals(b)).toBe(true);
  });

  it('null et undefined (corps absent) produisent la même empreinte', () => {
    const a = calculerEmpreinte(null);
    const b = calculerEmpreinte(undefined);
    expect(a.equals(b)).toBe(true);
  });

  it('rend un Buffer de 32 octets (SHA-256)', () => {
    const empreinte = calculerEmpreinte({ x: 1 });
    expect(empreinte).toBeInstanceOf(Buffer);
    expect(empreinte.length).toBe(32);
  });

  it('est déterministe : deux appels sur le même objet rendent la même empreinte', () => {
    const corps = { a: 1, b: [1, 2, 3], c: { d: 'x' } };
    expect(calculerEmpreinte(corps).equals(calculerEmpreinte(corps))).toBe(true);
  });
});
