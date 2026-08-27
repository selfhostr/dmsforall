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
const DEF_CREE_LE_DESC: DefinitionTri = {
  expression: sql`c.cree_le`,
  sens: 'desc',
  nullable: false,
  temporel: true,
};

/**
 * Table de définitions telle que la construit chaque appelant réel (`DEFINITIONS_TRI_CLIENTS`,
 * `DEFINITIONS_TRI_OR`, `DEFINITIONS_TRI_VEHICULES`) — c'est elle qui indique à
 * `decoderCurseurPourTri` si le tri demandé porte sur une colonne temporelle.
 */
const DEFINITIONS_TEST: Readonly<Record<string, DefinitionTri>> = {
  'numeroClient:asc': DEF_NUMERO_ASC,
  'nom:desc': { expression: sql`c.nom`, sens: 'desc', nullable: false },
  'creeLe:desc': DEF_CREE_LE_DESC,
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
  it('tri ASC : reprend strictement après (valeur, id) — comparaison de ROW, opérateur ">"', () => {
    // Forme ROW `(expr, id) > (valeur, id)` depuis le 27.08.2026 (banc de charge + migration 0073) :
    // remplace l'ancienne forme `OR` explicite, équivalence algébrique exacte (sémantique standard
    // de la comparaison ROW PostgreSQL), mais exploitable par un parcours d'index ORDONNÉ avec
    // arrêt anticipé au LIMIT — la forme `OR` forçait un balayage bitmap de tout le reste de la
    // table avant de trier (mesuré : `clients-page10`/`page50`, 400-500 ms sur 9916 clients).
    const cond = construireConditionKeyset(DEF_NUMERO_ASC, ID_EXPR, 'CL-000010', 'id-10');
    const { sql: texte, params } = rendu(cond);
    expect(texte).toBe('(c.numero, c.id) > ($1, $2)');
    expect(params).toEqual(['CL-000010', 'id-10']);
  });

  it('tri DESC : reprend strictement après (valeur, id) — comparaison de ROW, opérateur "<"', () => {
    const cond = construireConditionKeyset(DEF_NUMERO_DESC, ID_EXPR, 'CL-000010', 'id-10');
    const { sql: texte, params } = rendu(cond);
    expect(texte).toBe('(c.numero, c.id) < ($1, $2)');
    expect(params).toEqual(['CL-000010', 'id-10']);
  });

  it('valeur null (colonne non nullable) : reprend uniquement par id, sans jamais réexaminer une valeur', () => {
    const cond = construireConditionKeyset(DEF_NUMERO_ASC, ID_EXPR, null, 'id-10');
    const { sql: texte, params } = rendu(cond);
    expect(texte).toBe('(c.numero is null and c.id > $1)');
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

  it('valeur null : reprend dans la queue des NULL, départagée par id DANS LE SENS DU TRI (sens desc → "<")', () => {
    const cond = construireConditionKeyset(DEF_DATE_DESC_NULLABLE, ID_EXPR, null, 'id-5');
    const { sql: texte, params } = rendu(cond);
    expect(texte).toBe('(c.dernier_passage_le is null and c.id < $1)');
    expect(params).toEqual(['id-5']);
  });

  it(
    'DÉFAUT CORRIGÉ : valeur null sur un tri ASCENDANT nullable (ex. `plaque:asc`, ' +
      '`ouvertLe:asc`) reprend la queue des NULL avec `id > curseur.id`, PAS `id < curseur.id` — ' +
      "l'ancien code figeait `<` quel que soit `sens`, correct seulement pour desc ; sur asc ça " +
      're-rendait indéfiniment le même sous-ensemble de la queue NULL au lieu d’avancer ' +
      '(reproduit et corrigé le 27.08.2026, voir la comparaison directe côté `service-client-' +
      'vehicules.spec.ts` / rapport de tâche — client réel `dfa_dev` à 231 véhicules sans plaque)',
    () => {
      const DEF_ASC_NULLABLE: DefinitionTri = {
        expression: sql`p.valeur`,
        sens: 'asc',
        nullable: true,
      };
      const cond = construireConditionKeyset(DEF_ASC_NULLABLE, ID_EXPR, null, 'id-5');
      const { sql: texte, params } = rendu(cond);
      expect(texte).toBe('(p.valeur is null and c.id > $1)');
      expect(params).toEqual(['id-5']);
    },
  );
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
    expect(decoderCurseurPourTri(undefined, 'numeroClient:asc', DEFINITIONS_TEST)).toBeNull();
  });

  it('un curseur v2 valide se décode en {valeur, id} pour le tri demandé', () => {
    const curseur = encoderCurseurTrie({
      tri: 'numeroClient:asc',
      valeur: 42,
      id: 'a1b2c3d4-e5f6-4789-a012-3456789abcde',
    });
    expect(decoderCurseurPourTri(curseur, 'numeroClient:asc', DEFINITIONS_TEST)).toEqual({
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
    expect(() => decoderCurseurPourTri(curseur, 'nom:desc', DEFINITIONS_TEST)).toThrow();
  });
});

/**
 * Défaut n°1 (rapport de livraison, même classe que celle corrigée dans
 * `apps/api/src/pneus/pagination-triee.ts`) : `GET /clients`, `GET /clients/{id}/vehicules` et
 * `GET /clients/{id}/ordres-reparation` répondaient `500 ERREUR_INTERNE` sur un curseur v2
 * SYNTAXIQUEMENT valide (forme `{t,v,i}` correcte, `t` égal au tri demandé, `i` un uuid) mais dont
 * la valeur `v` n'était pas le texte natif PostgreSQL d'un `timestamptz`, pour les tris qui portent
 * sur une colonne temporelle (`creeLe:desc`, `ouvertLe:asc/desc`, `dernierPassageLe:desc`) —
 * reproduit en exécution réelle CONTRE UN AUTRE MODULE (pneus) partageant la même mécanique, PAS
 * par les tests d'intégration existants de ce module : ceux-ci n'exercent que des curseurs absents
 * ou ENCODÉS PAR LE SERVEUR (donc déjà valides). Un curseur FORGÉ avec une valeur arbitraire dans
 * `v` n'est exercé nulle part côté intégration.
 *
 * `decoderCurseurPourTri` doit désormais rejeter un tel curseur en `VALIDATION_ECHOUEE` (400)
 * AVANT toute requête SQL, pour tout tri dont la `DefinitionTri` associée porte `temporel: true`.
 */
describe('decoderCurseurPourTri — défaut n°1 : curseur syntaxiquement valide, valeur non temporelle', () => {
  function curseurV2(tri: string, v: unknown): string {
    const brut = JSON.stringify({ t: tri, v, i: '01dc576e-7560-4e7f-9fc7-2b1806186f67' });
    return Buffer.from(brut, 'utf8').toString('base64url');
  }

  it('rejette (VALIDATION_ECHOUEE) une valeur qui n’est pas un timestamptz PostgreSQL sur un tri temporel — c’était le crash reproduit', () => {
    const curseur = curseurV2('creeLe:desc', 'not-a-real-timestamp');

    expect(() => decoderCurseurPourTri(curseur, 'creeLe:desc', DEFINITIONS_TEST)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }),
    );
  });

  it('rejette une valeur numérique sur un tri temporel', () => {
    const curseur = curseurV2('creeLe:desc', 42);

    expect(() => decoderCurseurPourTri(curseur, 'creeLe:desc', DEFINITIONS_TEST)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }),
    );
  });

  it('rejette une chaîne vide sur un tri temporel', () => {
    const curseur = curseurV2('creeLe:desc', '');

    expect(() => decoderCurseurPourTri(curseur, 'creeLe:desc', DEFINITIONS_TEST)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ECHOUEE', status: 400 }),
    );
  });

  it('accepte une valeur null sur un tri temporel (branche NULLS LAST) sans lever', () => {
    const curseur = curseurV2('creeLe:desc', null);

    expect(() => decoderCurseurPourTri(curseur, 'creeLe:desc', DEFINITIONS_TEST)).not.toThrow();
  });

  it('accepte le texte natif PostgreSQL (avec microseconde) sur un tri temporel', () => {
    const curseur = curseurV2('creeLe:desc', '2026-04-01 08:00:00.123456+00');

    const decode = decoderCurseurPourTri(curseur, 'creeLe:desc', DEFINITIONS_TEST);

    expect(decode).toEqual({
      valeur: '2026-04-01 08:00:00.123456+00',
      id: '01dc576e-7560-4e7f-9fc7-2b1806186f67',
    });
  });

  it(
    'un tri NON temporel (numeroClient:asc, comparaison texte/texte sans cast en SQL) n’exige pas ' +
      'de format particulier — aucun risque de 22007 côté base, une chaîne arbitraire passe',
    () => {
      const curseur = curseurV2('numeroClient:asc', 'valeur-quelconque');

      expect(() =>
        decoderCurseurPourTri(curseur, 'numeroClient:asc', DEFINITIONS_TEST),
      ).not.toThrow();
    },
  );
});
