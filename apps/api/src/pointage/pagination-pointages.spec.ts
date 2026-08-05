import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  conditionKeysetPointage,
  decoderCurseurPointages,
  encoderCurseurTrie,
  ordreParDebutLe,
  valeurCurseurDepuisTriPointage,
} from './pagination-pointages';

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

describe('ordreParDebutLe / conditionKeysetPointage — inchangés, non couverts par le correctif', () => {
  it('ASC : deux termes distincts, départagés par id', () => {
    const ordre = ordreParDebutLe('asc');
    expect(ordre).toHaveLength(2);
  });

  it('conditionKeysetPointage caste ::timestamptz la valeur reçue', () => {
    const { sql: texte } = rendu(conditionKeysetPointage('desc', '2026-07-29 08:00:00+00', 'id-1'));
    expect(texte).toContain('::timestamptz');
  });

  it('valeurCurseurDepuisTriPointage canonicalise sans perte de microseconde', () => {
    expect(valeurCurseurDepuisTriPointage('2026-07-29 13:37:35.171181+00')).toBe(
      '2026-07-29T13:37:35.171181+00:00',
    );
  });
});

describe('decoderCurseurPointages — deux défauts corrigés (correctif pagination)', () => {
  it('aucun curseur fourni : rend null', () => {
    expect(decoderCurseurPointages(undefined, 'debutLe:desc')).toBeNull();
  });

  it('un curseur v2 légitime (encodé par le serveur) se décode normalement', () => {
    const curseur = encoderCurseurTrie({
      tri: 'debutLe:desc',
      valeur: '2026-07-29T13:37:35.171181+00:00',
      id: '01dc576e-7560-4e7f-9fc7-2b1806186f67',
    });
    expect(decoderCurseurPointages(curseur, 'debutLe:desc')).toEqual({
      valeur: '2026-07-29T13:37:35.171181+00:00',
      id: '01dc576e-7560-4e7f-9fc7-2b1806186f67',
    });
  });

  it(
    "DÉFAUT N°1 CORRIGÉ : un curseur syntaxiquement valide dont la valeur n'est pas un " +
      'timestamptz PostgreSQL sur debutLe (timestamptz, NOT NULL) est rejeté en ' +
      'VALIDATION_ECHOUEE (400) — c’était un 500 ERREUR_INTERNE (22007 PostgreSQL non intercepté) ' +
      "avant que `decoderCurseurTrie` soit appelé avec `typeValeur: 'temporel'`",
    () => {
      const curseur = curseurV2('debutLe:desc', 'not-a-real-timestamp');
      expect(() => decoderCurseurPointages(curseur, 'debutLe:desc')).toThrowError(
        expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }),
      );
    },
  );

  it('rejette une chaîne vide sur debutLe:asc', () => {
    const curseur = curseurV2('debutLe:asc', '');
    expect(() => decoderCurseurPointages(curseur, 'debutLe:asc')).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }),
    );
  });

  it(
    'DÉFAUT N°2 CORRIGÉ : une valeur numérique forgée sur debutLe:desc (NOT NULL, aucune valeur ' +
      "n'est jamais autre chose qu'une chaîne) est rejetée en VALIDATION_ECHOUEE (400) — le " +
      "garde-fou local levait auparavant une Error générique (500 ERREUR_INTERNE), alors qu'il " +
      "s'agit exactement de la même classe de donnée cliente malformée que le reste du module",
    () => {
      const curseur = curseurV2('debutLe:desc', 42);
      expect(() => decoderCurseurPointages(curseur, 'debutLe:desc')).toThrowError(
        expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }),
      );
    },
  );

  it(
    'DÉFAUT N°2 CORRIGÉ : une valeur null forgée sur debutLe:asc (NOT NULL) est rejetée en ' +
      'VALIDATION_ECHOUEE (400), jamais une Error non typée',
    () => {
      const curseur = curseurV2('debutLe:asc', null);
      expect(() => decoderCurseurPointages(curseur, 'debutLe:asc')).toThrowError(
        expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }),
      );
    },
  );

  it('un uuid mal formé pour `i` est rejeté', () => {
    const curseur = curseurV2('debutLe:desc', '2026-07-29 08:00:00+00', 'pas-un-uuid');
    expect(() => decoderCurseurPointages(curseur, 'debutLe:desc')).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }),
    );
  });

  it('un curseur base64url invalide est rejeté', () => {
    expect(() => decoderCurseurPointages('!!!pas-base64url-json!!!', 'debutLe:desc')).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }),
    );
  });

  it('un curseur encodé pour un autre tri (asc vs desc) est refusé, pas silencieusement réinterprété', () => {
    const curseur = curseurV2('debutLe:asc', '2026-07-29 08:00:00+00');
    expect(() => decoderCurseurPointages(curseur, 'debutLe:desc')).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }),
    );
  });

  it('aucun message d’erreur ne fuit de fragment SQL, de nom de colonne ou de trace', () => {
    const curseur = curseurV2('debutLe:desc', 42);
    try {
      decoderCurseurPointages(curseur, 'debutLe:desc');
      throw new Error('devrait avoir levé');
    } catch (e) {
      const message = (e as Error).message;
      expect(message).not.toMatch(/select|debut_le|timestamptz|22007|stack/i);
    }
  });
});
