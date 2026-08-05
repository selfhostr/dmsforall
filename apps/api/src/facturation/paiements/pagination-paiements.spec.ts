import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  construireConditionKeysetPaiement,
  construireOrderByPaiement,
  decoderCurseurPourTriPaiement,
  definitionTriPaiement,
  encoderCurseurTrie,
} from './pagination-paiements';

const dialect = new PgDialect();
function rendu(fragment: ReturnType<typeof sql>): {
  readonly sql: string;
  readonly params: readonly unknown[];
} {
  return dialect.sqlToQuery(fragment);
}

function curseurV2(tri: string, v: unknown, id = '01dc576e-7560-4e7f-9fc7-2b1806186f67'): string {
  const brut = JSON.stringify({ t: tri, v, i: id });
  return Buffer.from(brut, 'utf8').toString('base64url');
}

describe('definitionTriPaiement / construireOrderByPaiement — inchangés, non couverts par le correctif', () => {
  it('un tri inconnu lève VALIDATION_ECHOUEE', () => {
    expect(() =>
      definitionTriPaiement(
        'inconnu:desc' as unknown as Parameters<typeof definitionTriPaiement>[0],
      ),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }));
  });

  it('ORDER BY DESC sur dateValeur, départagé par id', () => {
    const { sql: texte } = rendu(
      construireOrderByPaiement(definitionTriPaiement('dateValeur:desc')),
    );
    expect(texte).toBe('p.date_valeur desc, p.id desc');
  });
});

describe(
  'decoderCurseurPourTriPaiement — AXE LOCAL DE VALIDATION (aucun tri de ce module n’est un ' +
    'timestamptz : `date_valeur` est une colonne `date`, `montantNonImputeCentimes` une expression ' +
    "numérique — la validation de contenu ne peut pas passer par `typeValeur: 'temporel'` de " +
    'common/pagination/curseur.ts, elle est portée localement par ce module)',
  () => {
    it('aucun curseur fourni : rend null', () => {
      expect(decoderCurseurPourTriPaiement(undefined, 'dateValeur:desc')).toBeNull();
    });

    it('un curseur v2 légitime (date ISO complète, forme réellement produite par ce module) se décode normalement', () => {
      const curseur = encoderCurseurTrie({
        tri: 'dateValeur:desc',
        valeur: '2026-07-29T00:00:00.000Z',
        id: '01dc576e-7560-4e7f-9fc7-2b1806186f67',
      });
      expect(decoderCurseurPourTriPaiement(curseur, 'dateValeur:desc')).toEqual({
        valeur: '2026-07-29T00:00:00.000Z',
        id: '01dc576e-7560-4e7f-9fc7-2b1806186f67',
      });
    });

    it('un curseur v2 légitime (montant non imputé, nombre) se décode normalement', () => {
      const curseur = encoderCurseurTrie({
        tri: 'montantNonImputeCentimes:desc',
        valeur: 4200,
        id: '01dc576e-7560-4e7f-9fc7-2b1806186f67',
      });
      expect(decoderCurseurPourTriPaiement(curseur, 'montantNonImputeCentimes:desc')).toEqual({
        valeur: 4200,
        id: '01dc576e-7560-4e7f-9fc7-2b1806186f67',
      });
    });

    it(
      'AXE DATE : rejette une chaîne qui n’est pas une date/date-heure ISO valide sur dateValeur:desc ' +
        '— c’était le risque de 22007/22008 PostgreSQL non intercepté sur `p.date_valeur` (colonne `date`)',
      () => {
        const curseur = curseurV2('dateValeur:desc', 'not-a-real-timestamp');
        expect(() => decoderCurseurPourTriPaiement(curseur, 'dateValeur:desc')).toThrowError(
          expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }),
        );
      },
    );

    it('AXE DATE : rejette une valeur numérique sur dateValeur:asc', () => {
      const curseur = curseurV2('dateValeur:asc', 42);
      expect(() => decoderCurseurPourTriPaiement(curseur, 'dateValeur:asc')).toThrowError(
        expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }),
      );
    });

    it('AXE DATE : accepte le texte natif PostgreSQL d’une colonne `date` ("AAAA-MM-JJ")', () => {
      const curseur = curseurV2('dateValeur:desc', '2026-07-29');
      expect(() => decoderCurseurPourTriPaiement(curseur, 'dateValeur:desc')).not.toThrow();
    });

    it(
      'AXE DATE : accepte la forme RÉELLEMENT produite aujourd’hui par ce module (Date JS sérialisé ' +
        'en JSON — voir l’en-tête de pagination-paiements.ts)',
      () => {
        const curseur = curseurV2('dateValeur:desc', '2026-07-29T00:00:00.000Z');
        expect(() => decoderCurseurPourTriPaiement(curseur, 'dateValeur:desc')).not.toThrow();
      },
    );

    it(
      'AXE NUMÉRIQUE : rejette une chaîne, même d’apparence numérique, sur ' +
        'montantNonImputeCentimes:desc — c’était le risque de 22P02 PostgreSQL non intercepté en ' +
        'comparant l’expression numérique `(abs(p.montant_centimes) - coalesce(...))` à une chaîne',
      () => {
        const curseur = curseurV2('montantNonImputeCentimes:desc', '4200');
        expect(() =>
          decoderCurseurPourTriPaiement(curseur, 'montantNonImputeCentimes:desc'),
        ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }));
      },
    );

    it('AXE NUMÉRIQUE : rejette une chaîne non numérique sur montantNonImputeCentimes:desc', () => {
      const curseur = curseurV2('montantNonImputeCentimes:desc', 'garbage');
      expect(() =>
        decoderCurseurPourTriPaiement(curseur, 'montantNonImputeCentimes:desc'),
      ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }));
    });

    it('AXE NUMÉRIQUE : accepte un nombre négatif ou décimal (aucune contrainte de signe/entier)', () => {
      const curseur = curseurV2('montantNonImputeCentimes:desc', -12.5);
      expect(() =>
        decoderCurseurPourTriPaiement(curseur, 'montantNonImputeCentimes:desc'),
      ).not.toThrow();
    });

    it('accepte une valeur null sur les trois tris (défensif, même doctrine que common/pagination/curseur.ts)', () => {
      for (const tri of [
        'dateValeur:desc',
        'dateValeur:asc',
        'montantNonImputeCentimes:desc',
      ] as const) {
        const curseur = curseurV2(tri, null);
        expect(() => decoderCurseurPourTriPaiement(curseur, tri)).not.toThrow();
      }
    });

    it('un uuid mal formé pour `i` est rejeté', () => {
      const curseur = curseurV2('dateValeur:desc', '2026-07-29', 'pas-un-uuid');
      expect(() => decoderCurseurPourTriPaiement(curseur, 'dateValeur:desc')).toThrowError(
        expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }),
      );
    });

    it('un curseur base64url invalide est rejeté', () => {
      expect(() =>
        decoderCurseurPourTriPaiement('!!!pas-base64url-json!!!', 'dateValeur:desc'),
      ).toThrowError(expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }));
    });

    it('un curseur encodé pour un autre tri est refusé, pas silencieusement réinterprété', () => {
      const curseur = curseurV2('dateValeur:asc', '2026-07-29');
      expect(() => decoderCurseurPourTriPaiement(curseur, 'dateValeur:desc')).toThrowError(
        expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }),
      );
    });

    it('aucun message d’erreur ne fuit de fragment SQL, de nom de colonne ou de trace', () => {
      const curseur = curseurV2('montantNonImputeCentimes:desc', 'garbage');
      try {
        decoderCurseurPourTriPaiement(curseur, 'montantNonImputeCentimes:desc');
        throw new Error('devrait avoir levé');
      } catch (e) {
        const message = (e as Error).message;
        expect(message).not.toMatch(/select|montant_centimes|somme_reglement|22p02|22007|stack/i);
      }
    });
  },
);

describe('construireConditionKeysetPaiement — inchangé, non couvert par le correctif', () => {
  it('tri DESC sur dateValeur : opérateur "<"', () => {
    const { sql: texte } = rendu(
      construireConditionKeysetPaiement(
        definitionTriPaiement('dateValeur:desc'),
        '2026-07-29',
        'id-1',
      ),
    );
    expect(texte).toContain('p.date_valeur < $1');
  });
});
