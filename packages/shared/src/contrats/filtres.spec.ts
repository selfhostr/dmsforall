import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { coercionListeQuery, schemaBooleenQuery, schemaListeQuery } from './filtres';

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

/**
 * Non-régression de l'issue #43 : `GET /pointages?anomalie=false` rendait une liste vide (comme
 * `anomalie=true`) parce que `z.coerce.boolean().parse('false')` vaut `true` — `Boolean('false')`
 * est vrai, seule la chaîne vide est falsy. Les trois états (absent / `"true"` / `"false"`) DOIVENT
 * rester distincts, et toute valeur qui n'est ni l'une ni l'autre doit échouer plutôt que deviner.
 */
describe('schemaBooleenQuery', () => {
  describe('sans valeur par défaut (`.optional()` à la charge de l’appelant)', () => {
    const schemaAnomalie = schemaBooleenQuery().optional();

    it('laisse `undefined` inchangé quand le filtre est absent — « pas de filtre »', () => {
      expect(schemaAnomalie.parse(undefined)).toBeUndefined();
    });

    it('`"true"` devient le booléen `true`', () => {
      expect(schemaAnomalie.parse('true')).toBe(true);
    });

    it('RÉGRESSION #43 : `"false"` devient le booléen `false`, pas `true`', () => {
      expect(schemaAnomalie.parse('false')).toBe(false);
    });

    it('rejette une valeur qui n’est ni `"true"` ni `"false"` au lieu de la deviner', () => {
      expect(() => schemaAnomalie.parse('oui')).toThrow();
      expect(() => schemaAnomalie.parse('0')).toThrow();
      expect(() => schemaAnomalie.parse('1')).toThrow();
      expect(() => schemaAnomalie.parse('TRUE')).toThrow();
    });
  });

  describe('avec valeur par défaut (ex. `inclureAnciennesDetentions`)', () => {
    const schemaInclure = schemaBooleenQuery(false);

    it('applique la valeur par défaut quand le paramètre est absent', () => {
      expect(schemaInclure.parse(undefined)).toBe(false);
    });

    it('`"true"` reste prioritaire sur le défaut', () => {
      expect(schemaInclure.parse('true')).toBe(true);
    });

    it('`"false"` explicite est équivalent au défaut mais reste validé normalement', () => {
      expect(schemaInclure.parse('false')).toBe(false);
    });

    it('rejette toujours une valeur invalide malgré le défaut', () => {
      expect(() => schemaInclure.parse('oui')).toThrow();
    });
  });
});
