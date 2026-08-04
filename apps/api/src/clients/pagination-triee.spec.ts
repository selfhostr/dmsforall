import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  construireConditionKeyset,
  construireOrderBy,
  decoderCurseurPourTri,
  encoderCurseurTrie,
  expressionTriValeur,
  valeurCurseurDepuisTri,
  type DefinitionTri,
} from './pagination-triee';

const dialect = new PgDialect();
/** Rend le texte SQL final et les paramètres liés, dans l'ordre — sans dépendre d'une base réelle. */
function rendu(fragment: ReturnType<typeof sql>): {
  readonly sql: string;
  readonly params: readonly unknown[];
} {
  return dialect.sqlToQuery(fragment);
}

const ID_EXPR = sql`c.id`;
const DEF_NUMERO_ASC: DefinitionTri = { expression: sql`c.numero`, sens: 'asc', nullable: false };
const DEF_NUMERO_DESC: DefinitionTri = { expression: sql`c.numero`, sens: 'desc', nullable: false };
const DEF_DATE_DESC_NULLABLE: DefinitionTri = {
  expression: sql`c.dernier_passage_le`,
  sens: 'desc',
  nullable: true,
};

describe('construireOrderBy', () => {
  it('trie ASC, départagé par id ASC, sans NULLS LAST quand la colonne est non nullable', () => {
    expect(rendu(construireOrderBy(DEF_NUMERO_ASC, ID_EXPR)).sql).toBe('c.numero asc , c.id asc');
  });

  it('trie DESC, départagé par id DESC', () => {
    expect(rendu(construireOrderBy(DEF_NUMERO_DESC, ID_EXPR)).sql).toBe(
      'c.numero desc , c.id desc',
    );
  });

  it('une colonne nullable ajoute NULLS LAST, quel que soit le sens', () => {
    expect(rendu(construireOrderBy(DEF_DATE_DESC_NULLABLE, ID_EXPR)).sql).toContain('nulls last');
  });
});

describe('construireConditionKeyset — reprise après curseur, non nullable', () => {
  it('tri ASC : reprend strictement après (valeur, id) — opérateur ">"', () => {
    const cond = construireConditionKeyset(DEF_NUMERO_ASC, ID_EXPR, 'CL-000010', 'id-10');
    const { sql: texte, params } = rendu(cond);
    expect(texte).toContain('c.numero > $1');
    expect(texte).toContain('c.numero = $2 and c.id > $3');
    expect(params).toEqual(['CL-000010', 'CL-000010', 'id-10']);
  });

  it('tri DESC : reprend strictement après (valeur, id) — opérateur "<"', () => {
    const cond = construireConditionKeyset(DEF_NUMERO_DESC, ID_EXPR, 'CL-000010', 'id-10');
    const { sql: texte, params } = rendu(cond);
    expect(texte).toContain('c.numero < $1');
    expect(params).toEqual(['CL-000010', 'CL-000010', 'id-10']);
  });

  it('valeur null (colonne non nullable) : reprend uniquement par id, sans jamais réexaminer une valeur', () => {
    const cond = construireConditionKeyset(DEF_NUMERO_ASC, ID_EXPR, null, 'id-10');
    const { sql: texte, params } = rendu(cond);
    expect(texte).toBe('(c.numero is null and c.id < $1)');
    expect(params).toEqual(['id-10']);
  });
});

describe('construireConditionKeyset — colonne nullable (NULLS LAST)', () => {
  it('une valeur non nulle inclut aussi les lignes NULL restantes (encore "à venir" derrière NULLS LAST)', () => {
    const cond = construireConditionKeyset(
      DEF_DATE_DESC_NULLABLE,
      ID_EXPR,
      '2026-01-01T00:00:00.000Z',
      'id-5',
    );
    const { sql: texte } = rendu(cond);
    expect(texte).toMatch(/or c\.dernier_passage_le is null\)$/);
  });

  it('valeur null : reprend dans la queue des NULL, départagée par id (comportement identique au non-nullable)', () => {
    const cond = construireConditionKeyset(DEF_DATE_DESC_NULLABLE, ID_EXPR, null, 'id-5');
    const { sql: texte, params } = rendu(cond);
    expect(texte).toBe('(c.dernier_passage_le is null and c.id < $1)');
    expect(params).toEqual(['id-5']);
  });
});

describe(
  'expressionTriValeur / valeurCurseurDepuisTri — une expression temporelle (`temporel: true`) ne doit ' +
    'JAMAIS perdre de précision sur la valeur de curseur (résolution microseconde PostgreSQL vs ' +
    'milliseconde de `Date` JavaScript, voir `common/pagination/valeur-temporelle.ts`)',
  () => {
    const DEF_CREE_LE: DefinitionTri = {
      expression: sql`c.cree_le`,
      sens: 'desc',
      nullable: false,
      temporel: true,
    };

    it('expressionTriValeur cast en ::text une expression marquée temporelle, pour empêcher le pilote de la rendre en Date', () => {
      const { sql: texte } = rendu(expressionTriValeur(DEF_CREE_LE));
      expect(texte).toBe('(c.cree_le)::text');
    });

    it('expressionTriValeur laisse une expression non temporelle inchangée (pas de cast superflu sur du texte déjà)', () => {
      const { sql: texte } = rendu(expressionTriValeur(DEF_NUMERO_ASC));
      expect(texte).toBe('c.numero');
    });

    it(
      'valeurCurseurDepuisTri canonicalise une valeur temporelle SANS jamais passer par Date : la ' +
        'microseconde du texte natif PostgreSQL survit intacte jusqu’au curseur encodé',
      () => {
        const valeur = valeurCurseurDepuisTri(DEF_CREE_LE, '2026-07-29 13:37:35.171181+00');
        expect(valeur).toBe('2026-07-29T13:37:35.171181+00:00');
      },
    );

    it(
      'régression directe du bug corrigé : une valeur temporelle qui transiterait par `new Date(...).toISOString()` ' +
        'tronquerait `.171181` en `.171` — `valeurCurseurDepuisTri` ne le fait jamais',
      () => {
        const valeur = valeurCurseurDepuisTri(DEF_CREE_LE, '2026-07-29 13:37:35.171181+00');
        expect(valeur).not.toBe(new Date('2026-07-29 13:37:35.171181+00').toISOString());
      },
    );

    it('valeurCurseurDepuisTri rejette un Date reçu pour une expression temporelle — révélateur d’un ::text manquant dans le SELECT', () => {
      expect(() =>
        valeurCurseurDepuisTri(
          DEF_CREE_LE,
          new Date('2026-07-29T13:37:35.171Z') as unknown as string,
        ),
      ).toThrow();
    });

    it('valeurCurseurDepuisTri laisse passer null (colonne NULLS LAST) sans tenter de le canonicaliser', () => {
      expect(valeurCurseurDepuisTri(DEF_CREE_LE, null)).toBeNull();
    });

    it('valeurCurseurDepuisTri laisse une valeur non temporelle (nombre, ex. numeroClient) totalement inchangée', () => {
      expect(valeurCurseurDepuisTri(DEF_NUMERO_ASC, 42)).toBe(42);
    });
  },
);

describe('decoderCurseurPourTri', () => {
  it('aucun curseur fourni : rend null (première page)', () => {
    expect(decoderCurseurPourTri(undefined, 'numeroClient:asc')).toBeNull();
  });

  it('un curseur v2 valide se décode en {valeur, id} pour le tri demandé', () => {
    const curseur = encoderCurseurTrie({
      tri: 'numeroClient:asc',
      valeur: 42,
      id: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
    });
    expect(decoderCurseurPourTri(curseur, 'numeroClient:asc')).toEqual({
      valeur: 42,
      id: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
    });
  });

  it('un curseur encodé pour un autre tri est refusé (pas silencieusement réinterprété)', () => {
    const curseur = encoderCurseurTrie({
      tri: 'numeroClient:asc',
      valeur: 42,
      id: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
    });
    expect(() => decoderCurseurPourTri(curseur, 'nom:desc')).toThrow();
  });
});
