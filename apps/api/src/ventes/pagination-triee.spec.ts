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
function rendu(fragment: ReturnType<typeof sql>): {
  readonly sql: string;
  readonly params: readonly unknown[];
} {
  return dialect.sqlToQuery(fragment);
}

const ID_EXPR = sql`dv.id`;

// Reflète `DEFINITIONS_TRI_DOSSIERS_VENTE` (`service-dossier-vente.ts`) : `prospectionLe` porte
// `temporel: true` (colonne `timestamptz`, `dv.cree_le`) ; `dateLivraisonEstimee` est une colonne
// `date` (délibérément SANS `temporel`, voir le commentaire d'origine) — exactement le mélange que
// le brief signale comme piège : router `'temporel'` en dur casserait `dateLivraisonEstimee`.
const DEF_PROSPECTION_LE_DESC: DefinitionTri = {
  expression: sql`dv.cree_le`,
  sens: 'desc',
  nullable: false,
  temporel: true,
};
const DEF_DATE_LIVRAISON_ASC: DefinitionTri = {
  expression: sql`dv.date_livraison_estimee`,
  sens: 'asc',
  nullable: true,
};

const DEFINITIONS_TEST: Readonly<Record<string, DefinitionTri>> = {
  'prospectionLe:desc': DEF_PROSPECTION_LE_DESC,
  'dateLivraisonEstimee:asc': DEF_DATE_LIVRAISON_ASC,
};

function curseurV2(tri: string, v: unknown, id = '01dc576e-7560-4e7f-9fc7-2b1806186f67'): string {
  const brut = JSON.stringify({ t: tri, v, i: id });
  return Buffer.from(brut, 'utf8').toString('base64url');
}

describe('construireOrderBy / expressionTriValeur — inchangés, non couverts par le correctif', () => {
  it('ORDER BY DESC sur prospectionLe, sans NULLS LAST (non nullable)', () => {
    expect(rendu(construireOrderBy(DEF_PROSPECTION_LE_DESC, ID_EXPR)).sql).toBe(
      'dv.cree_le desc , dv.id desc',
    );
  });

  it('expressionTriValeur caste ::text prospectionLe (temporel)', () => {
    expect(rendu(expressionTriValeur(DEF_PROSPECTION_LE_DESC)).sql).toBe('(dv.cree_le)::text');
  });

  it('expressionTriValeur laisse dateLivraisonEstimee inchangée (non temporel)', () => {
    expect(rendu(expressionTriValeur(DEF_DATE_LIVRAISON_ASC)).sql).toBe(
      'dv.date_livraison_estimee',
    );
  });

  it('valeurCurseurDepuisTri canonicalise une valeur temporelle sans passer par Date', () => {
    expect(valeurCurseurDepuisTri(DEF_PROSPECTION_LE_DESC, '2026-07-29 13:37:35.171181+00')).toBe(
      '2026-07-29T13:37:35.171181+00:00',
    );
  });
});

describe('decoderCurseurPourTri — routage temporel/texte selon la DefinitionTri (correctif)', () => {
  it('aucun curseur fourni : rend null', () => {
    expect(decoderCurseurPourTri(undefined, 'prospectionLe:desc', DEFINITIONS_TEST)).toBeNull();
  });

  it('un curseur v2 légitime se décode normalement pour le tri temporel prospectionLe:desc', () => {
    const curseur = encoderCurseurTrie({
      tri: 'prospectionLe:desc',
      valeur: '2026-07-29T13:37:35.171181+00:00',
      id: '01dc576e-7560-4e7f-9fc7-2b1806186f67',
    });
    expect(decoderCurseurPourTri(curseur, 'prospectionLe:desc', DEFINITIONS_TEST)).toEqual({
      valeur: '2026-07-29T13:37:35.171181+00:00',
      id: '01dc576e-7560-4e7f-9fc7-2b1806186f67',
    });
  });

  it(
    "DÉFAUT CORRIGÉ : un curseur syntaxiquement valide dont la valeur n'est pas un timestamptz " +
      'PostgreSQL sur le tri temporel prospectionLe:desc est rejeté en VALIDATION_ECHOUEE (400) — ' +
      'avant ce correctif, DEFINITIONS_TRI_DOSSIERS_VENTE portait déjà `temporel: true` mais ' +
      '`decoderCurseurPourTri` ne le lisait jamais (pas de paramètre `definitions`)',
    () => {
      const curseur = curseurV2('prospectionLe:desc', 'not-a-real-timestamp');
      expect(() =>
        decoderCurseurPourTri(curseur, 'prospectionLe:desc', DEFINITIONS_TEST),
      ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }));
    },
  );

  it('rejette une valeur numérique sur le tri temporel prospectionLe:desc', () => {
    const curseur = curseurV2('prospectionLe:desc', 42);
    expect(() =>
      decoderCurseurPourTri(curseur, 'prospectionLe:desc', DEFINITIONS_TEST),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }));
  });

  it('accepte une valeur null sur le tri temporel prospectionLe:desc (branche NULLS LAST)', () => {
    const curseur = curseurV2('prospectionLe:desc', null);
    expect(() =>
      decoderCurseurPourTri(curseur, 'prospectionLe:desc', DEFINITIONS_TEST),
    ).not.toThrow();
  });

  it(
    'AUCUN FAUX POSITIF : une chaîne arbitraire sur le tri NON temporel dateLivraisonEstimee:asc ' +
      '(colonne `date`, pas `timestamptz`) continue de fonctionner normalement',
    () => {
      const curseur = curseurV2('dateLivraisonEstimee:asc', 'valeur-quelconque');
      expect(() =>
        decoderCurseurPourTri(curseur, 'dateLivraisonEstimee:asc', DEFINITIONS_TEST),
      ).not.toThrow();
    },
  );

  it('un uuid mal formé pour `i` est rejeté', () => {
    const curseur = curseurV2('dateLivraisonEstimee:asc', 'x', 'pas-un-uuid');
    expect(() =>
      decoderCurseurPourTri(curseur, 'dateLivraisonEstimee:asc', DEFINITIONS_TEST),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }));
  });

  it('un curseur base64url invalide est rejeté', () => {
    expect(() =>
      decoderCurseurPourTri('!!!pas-base64url-json!!!', 'prospectionLe:desc', DEFINITIONS_TEST),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }));
  });

  it('un curseur encodé pour un autre tri est refusé (pas silencieusement réinterprété)', () => {
    const curseur = curseurV2('dateLivraisonEstimee:asc', 'x');
    expect(() =>
      decoderCurseurPourTri(curseur, 'prospectionLe:desc', DEFINITIONS_TEST),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }));
  });

  it('aucun message d’erreur ne fuit de fragment SQL ni de nom de colonne', () => {
    const curseur = curseurV2('prospectionLe:desc', 'not-a-real-timestamp');
    try {
      decoderCurseurPourTri(curseur, 'prospectionLe:desc', DEFINITIONS_TEST);
      throw new Error('devrait avoir levé');
    } catch (e) {
      const message = (e as Error).message;
      expect(message).not.toMatch(/select|cree_le|timestamptz|22007/i);
    }
  });
});
