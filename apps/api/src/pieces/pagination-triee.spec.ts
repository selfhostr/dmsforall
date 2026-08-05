import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  construireOrderBy,
  decoderCurseurPourTri,
  encoderCurseurTrie,
  expressionTriValeur,
  valeurCurseurDepuisTri,
  type DefinitionTri,
} from './pagination-triee';

const dialect = new PgDialect();
function rendu(fragment: ReturnType<typeof sql>): {
  readonly sql: string;
  readonly params: readonly unknown[];
} {
  return dialect.sqlToQuery(fragment);
}

const ID_EXPR = sql`a.id`;

// Reflète `DEFINITIONS_TRI_ARTICLES` (`service-article.ts`) : un mélange réel de tris temporels
// (`creeLe`, colonne `timestamptz`) et non temporels (`designation`, `numeroArticle`, texte) —
// exactement le piège signalé dans le brief : déclarer `temporel` en dur casserait `designation`.
const DEF_CREE_LE_DESC: DefinitionTri = {
  expression: sql`a.cree_le`,
  sens: 'desc',
  nullable: false,
  temporel: true,
};
const DEF_DESIGNATION_ASC: DefinitionTri = {
  expression: sql`a.designation`,
  sens: 'asc',
  nullable: false,
};
const DEF_NUMERO_ARTICLE_ASC: DefinitionTri = {
  expression: sql`a.numero_article`,
  sens: 'asc',
  nullable: true,
};

const DEFINITIONS_TEST: Readonly<Record<string, DefinitionTri>> = {
  'creeLe:desc': DEF_CREE_LE_DESC,
  'designation:asc': DEF_DESIGNATION_ASC,
  'numeroArticle:asc': DEF_NUMERO_ARTICLE_ASC,
};

function curseurV2(tri: string, v: unknown, id = '01dc576e-7560-4e7f-9fc7-2b1806186f67'): string {
  const brut = JSON.stringify({ t: tri, v, i: id });
  return Buffer.from(brut, 'utf8').toString('base64url');
}

describe('construireOrderBy / construireConditionKeyset — inchangés, non couverts par le correctif', () => {
  it('ORDER BY ASC, NULLS LAST pour une colonne nullable', () => {
    expect(rendu(construireOrderBy(DEF_NUMERO_ARTICLE_ASC, ID_EXPR)).sql).toBe(
      'a.numero_article asc nulls last, a.id asc',
    );
  });

  it('expressionTriValeur caste ::text une expression temporelle', () => {
    expect(rendu(expressionTriValeur(DEF_CREE_LE_DESC)).sql).toBe('(a.cree_le)::text');
  });

  it('valeurCurseurDepuisTri canonicalise une valeur temporelle sans passer par Date', () => {
    expect(valeurCurseurDepuisTri(DEF_CREE_LE_DESC, '2026-07-29 13:37:35.171181+00')).toBe(
      '2026-07-29T13:37:35.171181+00:00',
    );
  });
});

describe('decoderCurseurPourTri — routage temporel/texte selon la DefinitionTri (correctif)', () => {
  it('aucun curseur fourni : rend null', () => {
    expect(decoderCurseurPourTri(undefined, 'creeLe:desc', DEFINITIONS_TEST)).toBeNull();
  });

  it('un curseur v2 légitime (encodé par le serveur) se décode normalement pour un tri temporel', () => {
    const curseur = encoderCurseurTrie({
      tri: 'creeLe:desc',
      valeur: '2026-07-29T13:37:35.171181+00:00',
      id: '01dc576e-7560-4e7f-9fc7-2b1806186f67',
    });
    expect(decoderCurseurPourTri(curseur, 'creeLe:desc', DEFINITIONS_TEST)).toEqual({
      valeur: '2026-07-29T13:37:35.171181+00:00',
      id: '01dc576e-7560-4e7f-9fc7-2b1806186f67',
    });
  });

  it(
    "DÉFAUT CORRIGÉ : un curseur syntaxiquement valide dont la valeur n'est pas un timestamptz " +
      'PostgreSQL sur un tri temporel (creeLe:desc) est rejeté en VALIDATION_ECHOUEE (400), pas ' +
      'laissé traverser jusqu’à une éventuelle erreur SQL 22007 — avant ce correctif, DEFINITIONS_TRI_ARTICLES ' +
      'portait déjà `temporel: true` mais `decoderCurseurPourTri` ne le lisait jamais',
    () => {
      const curseur = curseurV2('creeLe:desc', 'not-a-real-timestamp');
      expect(() => decoderCurseurPourTri(curseur, 'creeLe:desc', DEFINITIONS_TEST)).toThrowError(
        expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }),
      );
    },
  );

  it('rejette une valeur numérique sur le tri temporel creeLe:desc', () => {
    const curseur = curseurV2('creeLe:desc', 42);
    expect(() => decoderCurseurPourTri(curseur, 'creeLe:desc', DEFINITIONS_TEST)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }),
    );
  });

  it('accepte une valeur null sur le tri temporel creeLe:desc (branche NULLS LAST)', () => {
    const curseur = curseurV2('creeLe:desc', null);
    expect(() => decoderCurseurPourTri(curseur, 'creeLe:desc', DEFINITIONS_TEST)).not.toThrow();
  });

  it(
    'AUCUN FAUX POSITIF : une chaîne arbitraire sur un tri TEXTE (designation:asc) continue de ' +
      'fonctionner normalement — aucune contrainte de format sur ce genre de colonne',
    () => {
      const curseur = curseurV2('designation:asc', 'valeur-quelconque, pas un horodatage');
      expect(() =>
        decoderCurseurPourTri(curseur, 'designation:asc', DEFINITIONS_TEST),
      ).not.toThrow();
    },
  );

  it(
    'AUCUN FAUX POSITIF : une chaîne arbitraire sur un tri nullable non temporel (numeroArticle:asc) ' +
      'continue de fonctionner normalement',
    () => {
      const curseur = curseurV2('numeroArticle:asc', 'ART-000123');
      expect(() =>
        decoderCurseurPourTri(curseur, 'numeroArticle:asc', DEFINITIONS_TEST),
      ).not.toThrow();
    },
  );

  it('un uuid mal formé pour `i` est rejeté (forme, indépendant du tri)', () => {
    const curseur = curseurV2('designation:asc', 'x', 'pas-un-uuid');
    expect(() => decoderCurseurPourTri(curseur, 'designation:asc', DEFINITIONS_TEST)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }),
    );
  });

  it('un curseur base64url invalide est rejeté', () => {
    expect(() =>
      decoderCurseurPourTri('!!!pas-base64url-json!!!', 'creeLe:desc', DEFINITIONS_TEST),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }));
  });

  it('un curseur encodé pour un autre tri est refusé (pas silencieusement réinterprété)', () => {
    const curseur = curseurV2('designation:asc', 'x');
    expect(() => decoderCurseurPourTri(curseur, 'creeLe:desc', DEFINITIONS_TEST)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }),
    );
  });

  it('aucun message d’erreur ne fuit de fragment SQL ni de nom de colonne', () => {
    const curseur = curseurV2('creeLe:desc', 'not-a-real-timestamp');
    try {
      decoderCurseurPourTri(curseur, 'creeLe:desc', DEFINITIONS_TEST);
      throw new Error('devrait avoir levé');
    } catch (e) {
      const message = (e as Error).message;
      expect(message).not.toMatch(/select|cree_le|timestamptz|22007/i);
    }
  });
});
