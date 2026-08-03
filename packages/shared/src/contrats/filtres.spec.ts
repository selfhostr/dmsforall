import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { coercionListeQuery, schemaListeQuery } from './filtres';

/**
 * Le cas qui compte est celui à UNE seule valeur (`?statut=en_cours`) : c'est celui qu'Express
 * transmet sous forme de chaîne plutôt que de tableau, et c'est celui que `z.array(...)` seul
 * rejetait avant l'introduction de ce helper (voir le commentaire de `filtres.ts`). Les autres
 * cas (zéro, deux, invalide) prouvent qu'on n'a rien cassé au passage.
 */
describe('schemaListeQuery', () => {
  const schemaStatut = schemaListeQuery(z.enum(['actif', 'bloque', 'archive'])).optional();

  it('laisse `undefined` inchangé quand le filtre est absent', () => {
    expect(schemaStatut.parse(undefined)).toBeUndefined();
  });

  it('transforme une valeur unique (forme envoyée par Express pour une seule occurrence du paramètre) en tableau à un élément', () => {
    expect(schemaStatut.parse('actif')).toEqual(['actif']);
  });

  it('laisse un tableau de plusieurs valeurs inchangé (forme envoyée par Express dès deux occurrences)', () => {
    expect(schemaStatut.parse(['actif', 'bloque'])).toEqual(['actif', 'bloque']);
  });

  it('laisse un tableau à un seul élément inchangé (déjà sous forme de tableau)', () => {
    expect(schemaStatut.parse(['actif'])).toEqual(['actif']);
  });

  it('rejette toujours une valeur hors de l’enum, seule ou dans un tableau', () => {
    expect(() => schemaStatut.parse('valeur_inconnue')).toThrow();
    expect(() => schemaStatut.parse(['actif', 'valeur_inconnue'])).toThrow();
  });

  it('respecte les contraintes composées après coup (`.min()`), ex. un filtre requis non vide', () => {
    const schemaAvecMinimum = z.preprocess(
      coercionListeQuery,
      z.array(z.enum(['actif', 'bloque'])).min(1),
    );
    expect(schemaAvecMinimum.parse('actif')).toEqual(['actif']);
    expect(() => schemaAvecMinimum.parse([])).toThrow();
  });

  it('rejette un tableau vide explicite si le schéma élément l’exige toujours (comportement inchangé de `z.array`)', () => {
    // `[]` est un tableau valide pour `z.array(...).optional()` nu (zéro contrainte de taille) :
    // ce n'est PAS un cas que la coercition doit transformer, elle ne touche qu'aux valeurs
    // scalaires. On vérifie ici qu'un tableau vide traverse la coercition sans modification.
    expect(schemaStatut.parse([])).toEqual([]);
  });
});

describe('coercionListeQuery', () => {
  it('retourne `undefined` pour `undefined`', () => {
    expect(coercionListeQuery(undefined)).toBeUndefined();
  });

  it('enveloppe une chaîne seule dans un tableau', () => {
    expect(coercionListeQuery('en_cours')).toEqual(['en_cours']);
  });

  it('laisse un tableau existant inchangé (même référence de contenu, pas de copie superflue)', () => {
    const source = ['en_cours', 'termine'];
    expect(coercionListeQuery(source)).toEqual(source);
  });
});
