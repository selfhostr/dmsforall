import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import type { FiltresVehicules } from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import { Horloge } from '../common/horloge';
import { decoderCurseurTrie } from '../common/pagination';
import { ServiceVehicule } from './service-vehicule';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };

// `decoderCurseurTrie` valide `id` contre un format UUID (`REGEX_UUID`, `common/pagination/curseur.ts`)
// — les identifiants de véhicule doivent donc en avoir la forme, pas de simples libellés `v1`/`v2`.
const V1 = '11111111-1111-4111-8111-111111111111';
const V2 = '22222222-2222-4222-8222-222222222222';
const V3 = '33333333-3333-4333-8333-333333333333';

/**
 * Ligne brute EXACTEMENT comme la rend `executerListeVehicules` (mêmes alias de colonnes que le
 * `select` SQL de `service-vehicule.ts`). `creeLe` est fourni EN CHAÎNE par défaut — pas parce que
 * le pilote `pg` rendrait par défaut un `timestamptz` en chaîne (mesuré : il rend un `Date`, comme
 * le query builder Drizzle typé), mais parce que le `SELECT` de `executerListeVehicules` cast
 * explicitement cette colonne en `v.cree_le::text` pour l'EMPÊCHER de le faire : `Date` n'a qu'une
 * résolution MILLISECONDE quand PostgreSQL stocke `timestamptz` à la MICROSECONDE, et cette colonne
 * alimente la valeur de curseur de pagination. Un double qui renverrait un `Date` ici mentirait sur
 * ce que rend réellement la requête SQL et laisserait passer la régression que ce fichier existe
 * pour couvrir (voir `valeurCurseurTimestamptz()`, `common/pagination/valeur-temporelle.ts`, et le
 * même motif dans `clients/service-client.spec.ts`).
 */
function ligneBrute(champs: {
  readonly id: string;
  readonly creeLe: string;
  readonly plaqueValeur?: string | null;
}): Record<string, unknown> {
  return {
    id: champs.id,
    marque: 'VW',
    modele: 'Golf',
    version: null,
    vin: null,
    date_1re_circulation: null,
    identification_incomplete: false,
    cree_le: champs.creeLe,
    plaque_valeur: champs.plaqueValeur ?? null,
    plaque_canton: champs.plaqueValeur ? 'VD' : null,
    prochaine_expertise_le: null,
  };
}

function txFactice(executes: ReadonlyArray<{ rows: readonly unknown[] }>) {
  const queue = [...executes];
  const tx = {
    execute: vi.fn((_requete: unknown) => Promise.resolve(queue.shift() ?? { rows: [] })),
  };
  return { tx: tx as unknown as TransactionDfa, execute: tx.execute };
}

function accesFactice(tx: TransactionDfa): AccesBase {
  return {
    enTenant: vi.fn((_ctx: ContexteTenant, travail: (tx: TransactionDfa) => Promise<unknown>) =>
      travail(tx),
    ),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  } as unknown as AccesBase;
}

const FILTRES_TRI_CREE_LE: FiltresVehicules = { tri: 'creeLe:desc' } as FiltresVehicules;

describe('ServiceVehicule.lister — SQL brut (tx.execute), tri creeLe:desc', () => {
  it('cree_le rendu en texte (::text explicite du SELECT) : ne lève pas, et le curseur suivant encode la bonne valeur ISO', async () => {
    // 3 lignes pour une limite de 2 → une page suivante existe (aUnePageSuivante = lignes.length > limite).
    const { tx } = txFactice([
      {
        rows: [
          ligneBrute({ id: V1, creeLe: '2026-07-01T08:00:00.000Z' }),
          ligneBrute({ id: V2, creeLe: '2026-06-30T08:00:00.000Z' }),
          ligneBrute({ id: V3, creeLe: '2026-06-29T08:00:00.000Z' }),
        ],
      },
    ]);
    const service = new ServiceVehicule(accesFactice(tx), new Horloge());

    const page = await service.lister(CTX, FILTRES_TRI_CREE_LE, { limite: 2 });

    expect(page.donnees).toHaveLength(2);
    expect(page.donnees.map((v) => v.id)).toEqual([V1, V2]);
    expect(page.curseurSuivant).not.toBeNull();

    // Le curseur doit porter la valeur canonique ISO-8601 microseconde de la dernière ligne de
    // page (v2), rendue par `valeurCurseurTimestamptz()` — 6 chiffres de microsecondes fixes et
    // décalage explicite `+00:00`, jamais `Invalid Date` (ce qu'un appel à `.toISOString()` sur une
    // chaîne aurait fait planter avant correction).
    const decode = decoderCurseurTrie(page.curseurSuivant as string, 'creeLe:desc');
    expect(decode.valeur).toBe('2026-06-30T08:00:00.000000+00:00');
    expect(decode.id).toBe(V2);
  });

  it('suit réellement le curseur sur la page suivante — le chemin qui casse en production, absent de toute autre couverture', async () => {
    const { tx, execute } = txFactice([
      {
        rows: [
          ligneBrute({ id: V1, creeLe: '2026-07-01T08:00:00.000Z' }),
          ligneBrute({ id: V2, creeLe: '2026-06-30T08:00:00.000Z' }),
          ligneBrute({ id: V3, creeLe: '2026-06-29T08:00:00.000Z' }),
        ],
      },
      {
        // Page 2 : plus aucune ligne au-delà de la limite → pas de troisième page.
        rows: [ligneBrute({ id: V3, creeLe: '2026-06-29T08:00:00.000Z' })],
      },
    ]);
    const service = new ServiceVehicule(accesFactice(tx), new Horloge());

    const page1 = await service.lister(CTX, FILTRES_TRI_CREE_LE, { limite: 2 });
    expect(page1.curseurSuivant).not.toBeNull();

    // Reprend EXACTEMENT comme le ferait un client HTTP : le curseur rendu par la page 1 est
    // renvoyé tel quel comme paramètre `curseur` de l'appel suivant.
    const page2 = await service.lister(CTX, FILTRES_TRI_CREE_LE, {
      limite: 2,
      curseur: page1.curseurSuivant as string,
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(page2.donnees).toHaveLength(1);
    expect(page2.donnees[0]?.id).toBe(V3);
    expect(page2.curseurSuivant).toBeNull();
  });

  it('une seule ligne (pas de page suivante) : le curseur est bien null, sans appel à toISOString() sur une chaîne', async () => {
    const { tx } = txFactice([
      { rows: [ligneBrute({ id: V1, creeLe: '2026-07-01T08:00:00.000Z' })] },
    ]);
    const service = new ServiceVehicule(accesFactice(tx), new Horloge());

    const page = await service.lister(CTX, FILTRES_TRI_CREE_LE, { limite: 2 });

    expect(page.donnees).toHaveLength(1);
    expect(page.curseurSuivant).toBeNull();
  });

  it('le SELECT sélectionne v.cree_le avec un cast ::text explicite, jamais laissé au parseur par défaut du pilote', async () => {
    const { tx, execute } = txFactice([{ rows: [] }]);
    const service = new ServiceVehicule(accesFactice(tx), new Horloge());

    await service.lister(CTX, FILTRES_TRI_CREE_LE, { limite: 2 });

    const appel = execute.mock.calls[0]?.[0] as SQL;
    const { sql: texte } = new PgDialect().sqlToQuery(appel);
    expect(texte).toContain('v.cree_le::text');
  });

  it(
    'régression directe (jeu de démo, 4 véhicules créés en lot partageant EXACTEMENT la même ' +
      'microseconde) : le curseur encodé préserve la microseconde intacte, jamais tronquée à la ' +
      "milliseconde d'un `Date` JavaScript — c'est cette troncature qui faisait sauter la page 2 " +
      'entière (comparaison keyset `cree_le < curseur_tronqué` fausse pour toute ligne réelle à ' +
      'pleine précision)',
    async () => {
      const MEME_INSTANT = '2026-07-29 13:37:35.171181+00';
      const { tx } = txFactice([
        {
          rows: [
            ligneBrute({ id: V1, creeLe: MEME_INSTANT }),
            ligneBrute({ id: V2, creeLe: MEME_INSTANT }),
          ],
        },
      ]);
      const service = new ServiceVehicule(accesFactice(tx), new Horloge());

      const page = await service.lister(CTX, FILTRES_TRI_CREE_LE, { limite: 1 });

      expect(page.donnees).toHaveLength(1);
      expect(page.curseurSuivant).not.toBeNull();
      const decode = decoderCurseurTrie(page.curseurSuivant as string, 'creeLe:desc');
      expect(decode.valeur).toBe('2026-07-29T13:37:35.171181+00:00');
      // La preuve directe de la régression : `new Date(...).toISOString()` tronquerait `.171181`
      // en `.171`, une valeur DIFFÉRENTE de celle réellement stockée en base.
      expect(decode.valeur).not.toBe(new Date(MEME_INSTANT).toISOString());
    },
  );
});

/**
 * Défaut n°1 (rapport de livraison, même classe que celle corrigée dans
 * `apps/api/src/pneus/pagination-triee.ts`) : `GET /vehicules?tri=creeLe:desc` répondait `500
 * ERREUR_INTERNE` sur un curseur v2 SYNTAXIQUEMENT valide (forme `{t,v,i}` correcte, `t` égal au
 * tri demandé, `i` un uuid) mais dont la valeur `v` n'était pas le texte natif PostgreSQL d'un
 * `timestamptz` : `construireTriEtSeuil()` (`service-vehicule.ts`) caste `${v}::timestamptz`
 * directement dans la clause `WHERE` pour ce tri, sans qu'aucune validation de contenu n'ait
 * jamais eu lieu avant. Chaque cas ci-dessous doit être rejeté AVANT tout appel à `tx.execute`.
 */
describe('ServiceVehicule.lister — curseur forgé : rejet 400 avant toute requête SQL', () => {
  function txQuiEchoueSiInterroge(): TransactionDfa {
    return {
      execute: vi.fn(() => {
        throw new Error('ne doit jamais être atteint : le curseur devait être rejeté avant.');
      }),
    } as unknown as TransactionDfa;
  }

  function curseurV2(tri: string, v: unknown, id = V1): string {
    const brut = JSON.stringify({ t: tri, v, i: id });
    return Buffer.from(brut, 'utf8').toString('base64url');
  }

  it('tri creeLe:desc (temporel) : rejette une valeur qui n’est pas un timestamptz PostgreSQL', async () => {
    const service = new ServiceVehicule(accesFactice(txQuiEchoueSiInterroge()), new Horloge());

    await expect(
      service.lister(CTX, FILTRES_TRI_CREE_LE, {
        limite: 2,
        curseur: curseurV2('creeLe:desc', 'not-a-real-timestamp'),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
  });

  it('tri creeLe:desc (temporel) : rejette une valeur numérique', async () => {
    const service = new ServiceVehicule(accesFactice(txQuiEchoueSiInterroge()), new Horloge());

    await expect(
      service.lister(CTX, FILTRES_TRI_CREE_LE, {
        limite: 2,
        curseur: curseurV2('creeLe:desc', 42),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
  });

  it('tri creeLe:desc (temporel) : rejette une chaîne vide', async () => {
    const service = new ServiceVehicule(accesFactice(txQuiEchoueSiInterroge()), new Horloge());

    await expect(
      service.lister(CTX, FILTRES_TRI_CREE_LE, {
        limite: 2,
        curseur: curseurV2('creeLe:desc', ''),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
  });

  it('rejette un curseur encodé pour un autre tri (plaque:asc) alors que creeLe:desc est demandé', async () => {
    const service = new ServiceVehicule(accesFactice(txQuiEchoueSiInterroge()), new Horloge());

    await expect(
      service.lister(CTX, FILTRES_TRI_CREE_LE, {
        limite: 2,
        curseur: curseurV2('plaque:asc', 'VD 123456'),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
  });

  it('rejette un uuid mal formé dans "i"', async () => {
    const service = new ServiceVehicule(accesFactice(txQuiEchoueSiInterroge()), new Horloge());

    await expect(
      service.lister(CTX, FILTRES_TRI_CREE_LE, {
        limite: 2,
        curseur: curseurV2('creeLe:desc', '2026-01-01 00:00:00+00', 'pas-un-uuid'),
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
  });

  it('rejette un base64 invalide', async () => {
    const service = new ServiceVehicule(accesFactice(txQuiEchoueSiInterroge()), new Horloge());

    await expect(
      service.lister(CTX, FILTRES_TRI_CREE_LE, { limite: 2, curseur: '!!!pas-base64url!!!' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE', status: 400 });
  });

  it(
    'tri plaque:asc (NON temporel, comparaison texte/texte sans cast en SQL) : une valeur ' +
      'arbitraire n’a pas besoin d’être un timestamptz — aucun risque de 22007 côté base',
    async () => {
      const { tx } = txFactice([{ rows: [] }]);
      const service = new ServiceVehicule(accesFactice(tx), new Horloge());

      await expect(
        service.lister(CTX, { tri: 'plaque:asc' } as FiltresVehicules, {
          limite: 2,
          curseur: curseurV2('plaque:asc', 'valeur-quelconque'),
        }),
      ).resolves.toMatchObject({ donnees: [] });
    },
  );
});
