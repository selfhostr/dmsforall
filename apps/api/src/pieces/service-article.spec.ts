import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import type {
  ReponseMemorisable,
  RequeteIdempotente,
  ResultatIdempotent,
  ServiceIdempotence,
} from '../common/idempotence';
import { decoderCurseurTrie } from '../common/pagination';
import type { LigneArticle, LigneArticleReference } from '../db/schema';
import { ServiceArticle } from './service-article';

const dialect = new PgDialect();

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };

function ligneArticle(champs: Partial<LigneArticle> = {}): LigneArticle {
  return {
    id: 'a1',
    tenantId: 'tid-1',
    numeroArticle: 'P-000001',
    designation: 'Plaquettes de frein avant',
    marque: null,
    categorie: 'piece_mecanique',
    statut: 'actif',
    referencePrincipale: '1K0698151',
    codeBarres: null,
    prixAchatCentimes: 4000,
    prixVenteTtcCentimes: 8900,
    tauxTvaPourmille: 81,
    estEchangeStandard: false,
    montantConsigneTtcCentimes: null,
    referenceRemplacementId: null,
    creeLe: new Date('2026-07-31T08:00:00.000Z'),
    modifieLe: new Date('2026-07-31T08:00:00.000Z'),
    ...champs,
  } as LigneArticle;
}

/**
 * Fausse transaction : `.where()` rend un objet à la fois THENABLE (`await tx.select()...where(x)`
 * directement, sans `.limit()`/`.orderBy()` — utilisé par `chargerSousCollections` pour
 * `stockArticle`) et CHAÎNABLE (`.limit()`, `.orderBy()` — utilisés ailleurs), tous les trois tirant
 * de la MÊME file `selects`, dans l'ordre d'appel du service. `update()`/`insert()` capturent leurs
 * arguments pour vérifier le contenu écrit sans toucher réellement une base.
 */
function txFactice(
  plan: {
    selects?: readonly unknown[][];
    executes?: ReadonlyArray<{ rows: readonly unknown[] }>;
  } = {},
) {
  const selects = [...(plan.selects ?? [])];
  const executes = [...(plan.executes ?? [])];
  const setArgs: unknown[] = [];
  const insertValuesArgs: Array<Record<string, unknown>> = [];

  function chaineWhere() {
    const valeur = Promise.resolve(selects.shift() ?? []);
    return {
      limit: () => valeur,
      orderBy: () => valeur,
      then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
        valeur.then(resolve, reject),
    };
  }

  const tx = {
    select: () => ({ from: () => ({ where: () => chaineWhere() }) }),
    update: () => ({
      set: (vals: unknown) => {
        setArgs.push(vals);
        return { where: () => Promise.resolve(undefined) };
      },
    }),
    insert: (_table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        insertValuesArgs.push(vals);
        return Promise.resolve(undefined);
      },
    }),
    // `listerReferences` (`GET /articles/{id}/references`) exécute du SQL brut via `tx.execute`,
    // même patron que `ServiceVehicule.lister` (`vehicules/service-vehicule.spec.ts`) : la file
    // `executes` sert les pages dans l'ordre d'appel, indépendamment de `selects`.
    execute: vi.fn((_requete: unknown) => Promise.resolve(executes.shift() ?? { rows: [] })),
  };

  return { tx: tx as unknown as TransactionDfa, setArgs, insertValuesArgs, execute: tx.execute };
}

function accesFactice(tx: TransactionDfa): AccesBase {
  return {
    enTenant: vi.fn((_ctx, travail) => travail(tx)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
}

function idempotenceFactice(tx: TransactionDfa): ServiceIdempotence {
  return {
    async executer<T extends ReponseMemorisable>(
      _ctx: ContexteTenant,
      _requete: RequeteIdempotente,
      travail: (tx: TransactionDfa) => Promise<T>,
    ): Promise<ResultatIdempotent<T>> {
      const reponse = await travail(tx);
      return { reponse, rejoue: false };
    },
  };
}

describe(
  'ServiceArticle.modifier — F-01-bis : `.partial()` zod n’annule pas un `.default(...)`, ' +
    '`estEchangeStandard` ne doit jamais être réinitialisé par un PATCH qui ne le mentionne pas',
  () => {
    it('un `PATCH` ne portant que `designation` ne touche pas `estEchangeStandard` (défaut fantôme F-01-bis)', async () => {
      const { tx, setArgs } = txFactice({
        selects: [
          [ligneArticle({ estEchangeStandard: true, montantConsigneTtcCentimes: 5000 })], // chargerOu404
          [
            ligneArticle({
              designation: 'Nouvelle désignation',
              estEchangeStandard: true,
              montantConsigneTtcCentimes: 5000,
            }),
          ], // reload
          [], // références
          [], // stocks
        ],
      });
      const service = new ServiceArticle(accesFactice(tx), idempotenceFactice(tx));

      // `corpsBrut` — exactement ce que `@Body()` rend côté contrôleur, jamais pré-parsé : le
      // service doit lui-même distinguer « non envoyé » de « envoyé false » (`neGarderQueChampsEnvoyes`).
      await service.modifier(CTX, 'magasinier', 'a1', { designation: 'Nouvelle désignation' });

      expect(setArgs[0]).toMatchObject({ designation: 'Nouvelle désignation' });
      // Preuve du défaut corrigé : `estEchangeStandard` ne doit JAMAIS apparaître dans les valeurs
      // écrites puisque le PATCH ne l’a jamais mentionné.
      expect(setArgs[0]).not.toHaveProperty('estEchangeStandard');
    });

    it('cas symétrique : un `PATCH { estEchangeStandard: false }` explicite reste appliqué (valeur métier, pas une absence)', async () => {
      const { tx, setArgs } = txFactice({
        selects: [
          [ligneArticle({ estEchangeStandard: true, montantConsigneTtcCentimes: 5000 })], // chargerOu404
          [ligneArticle({ estEchangeStandard: false, montantConsigneTtcCentimes: null })], // reload
          [], // références
          [], // stocks
        ],
      });
      const service = new ServiceArticle(accesFactice(tx), idempotenceFactice(tx));

      await service.modifier(CTX, 'magasinier', 'a1', {
        estEchangeStandard: false,
        montantConsigneTtcCentimes: null,
      });

      expect(setArgs[0]).toMatchObject({
        estEchangeStandard: false,
        montantConsigneTtcCentimes: null,
      });
    });
  },
);

describe('ServiceArticle.ajouterReference — RP-03 : une référence n’appartient qu’à un seul article', () => {
  it('409 ARTICLE_REFERENCE_COLLISION quand la référence existe déjà, portée par un AUTRE article, sans écriture', async () => {
    const { tx, setArgs, insertValuesArgs } = txFactice({
      selects: [
        [ligneArticle()], // chargerOu404
        [
          {
            id: 'ref-1',
            articleId: 'AUTRE-ARTICLE',
            tenantId: 'tid-1',
            type: 'equivalente',
            reference: '1K0698151X',
            fournisseurId: null,
            creeLe: new Date(),
          },
        ],
      ],
    });
    const service = new ServiceArticle(accesFactice(tx), idempotenceFactice(tx));

    await expect(
      service.ajouterReference(CTX, 'direction', 'a1', {
        type: 'equivalente',
        reference: '1K0698151X',
      }),
    ).rejects.toMatchObject({ code: 'ARTICLE_REFERENCE_COLLISION', status: 409 });

    expect(setArgs).toHaveLength(0);
    expect(insertValuesArgs).toHaveLength(0);
  });

  it('upsert accepté quand la référence existe déjà sur LE MÊME article (met à jour type/fournisseurId)', async () => {
    const { tx, setArgs, insertValuesArgs } = txFactice({
      selects: [
        [ligneArticle()],
        [
          {
            id: 'ref-1',
            articleId: 'a1',
            tenantId: 'tid-1',
            type: 'equivalente',
            reference: '1K0698151X',
            fournisseurId: null,
            creeLe: new Date(),
          },
        ],
        [ligneArticle()], // reload
        [], // références (chargerSousCollections)
        [], // stocks (chargerSousCollections)
      ],
    });
    const service = new ServiceArticle(accesFactice(tx), idempotenceFactice(tx));

    await service.ajouterReference(CTX, 'direction', 'a1', {
      type: 'fournisseur',
      reference: '1K0698151X',
      fournisseurId: 'f1',
    });

    expect(setArgs).toHaveLength(1);
    expect(insertValuesArgs).toHaveLength(0); // MAJ, pas insertion.
  });
});

describe('ServiceArticle.marquerObsolete — RP-04 : remplaçant requis si une référence `remplace_par` existe déjà', () => {
  it('400 ARTICLE_REMPLACANT_REQUIS quand une référence remplace_par existe et qu’aucun `referenceRemplacementId` n’est fourni', async () => {
    const { tx, setArgs } = txFactice({
      selects: [
        [ligneArticle()], // chargerOu404
        [{ id: 'ref-remplacement' }], // remplacantsDeclares (type = remplace_par)
      ],
    });
    const service = new ServiceArticle(accesFactice(tx), idempotenceFactice(tx));

    await expect(service.marquerObsolete(CTX, 'direction', 'a1', {})).rejects.toMatchObject({
      code: 'ARTICLE_REMPLACANT_REQUIS',
      status: 400,
    });
    expect(setArgs).toHaveLength(0);
  });

  it('accepté sans remplaçant si aucune référence remplace_par n’existe pour cet article', async () => {
    const { tx, setArgs } = txFactice({
      selects: [
        [ligneArticle()],
        [], // aucune référence remplace_par
        [ligneArticle({ statut: 'obsolete' })], // reload
        [], // références
        [], // stocks
      ],
    });
    const service = new ServiceArticle(accesFactice(tx), idempotenceFactice(tx));

    const resultat = await service.marquerObsolete(CTX, 'direction', 'a1', {});

    expect(resultat.donnees.statut).toBe('obsolete');
    expect(setArgs).toHaveLength(1);
  });
});

describe('ServiceArticle.desactiver — §6.1 : refusé si une réservation active porte sur l’article', () => {
  it('409 ARTICLE_DESACTIVATION_IMPOSSIBLE sans écriture quand une réservation active existe', async () => {
    const { tx, setArgs } = txFactice({
      selects: [
        [ligneArticle()], // chargerOu404
        [{ id: 'resa-active' }], // reservationsActives
      ],
    });
    const service = new ServiceArticle(accesFactice(tx), idempotenceFactice(tx));

    await expect(service.desactiver(CTX, 'direction', 'a1', {})).rejects.toMatchObject({
      code: 'ARTICLE_DESACTIVATION_IMPOSSIBLE',
      status: 409,
    });
    expect(setArgs).toHaveLength(0);
  });

  it('accepté quand aucune réservation active ne porte sur l’article', async () => {
    const { tx, setArgs } = txFactice({
      selects: [
        [ligneArticle()],
        [], // aucune réservation active
        [ligneArticle({ statut: 'desactive' })], // reload
        [],
        [],
      ],
    });
    const service = new ServiceArticle(accesFactice(tx), idempotenceFactice(tx));

    const resultat = await service.desactiver(CTX, 'direction', 'a1', {});

    expect(resultat.donnees.statut).toBe('desactive');
    expect(setArgs).toHaveLength(1);
  });
});

describe('ServiceArticle — masquage du prix d’achat par rôle (§11, RF-115/RF-116 appliqué au domaine pièces)', () => {
  it('un rôle SANS le droit de voir le prix d’achat (vendeur) reçoit `prixAchatCentimes: null` même si la ligne en base porte une valeur', async () => {
    const { tx } = txFactice({
      selects: [[ligneArticle({ prixAchatCentimes: 4000 })], [], []],
    });
    const service = new ServiceArticle(accesFactice(tx), idempotenceFactice(tx));

    const resultat = await service.parId(CTX, 'vendeur', 'a1');

    expect(resultat.prixAchatCentimes).toBeNull();
  });

  it('un rôle AVEC le droit (magasinier) reçoit la valeur réelle', async () => {
    const { tx } = txFactice({
      selects: [[ligneArticle({ prixAchatCentimes: 4000 })], [], []],
    });
    const service = new ServiceArticle(accesFactice(tx), idempotenceFactice(tx));

    const resultat = await service.parId(CTX, 'magasinier', 'a1');

    expect(resultat.prixAchatCentimes).toBe(4000);
  });
});

function ligneReference(champs: Partial<LigneArticleReference> = {}): LigneArticleReference {
  return {
    id: 'ref-1',
    tenantId: 'tid-1',
    articleId: 'a1',
    type: 'equivalente',
    reference: '1K0698151X',
    fournisseurId: null,
    creeLe: new Date('2026-07-31T08:00:00.000Z'),
    ...champs,
  } as LigneArticleReference;
}

/**
 * `GET /articles/{id}/references` — la suite paginée de `ArticleDto.references` au-delà de
 * `referencesTronquees` (constat de ce lot : la troncature à `SEUIL_REFERENCES_EMBARQUEES_ARTICLE`
 * était déjà signalée par un booléen explicite, mais AUCUN endpoint ne permettait d'en récupérer la
 * suite — silence identique au défaut de pagination corrigé ailleurs le même jour). Même patron de
 * test que `clients/service-client.spec.ts` (curseur v2 sur `cree_le`, `timestamptz`).
 */
describe('ServiceArticle.listerReferences — GET /articles/{id}/references, la suite de referencesTronquees', () => {
  it('404 RESSOURCE_INTROUVABLE si l’article n’existe pas pour ce tenant, sans exécuter la requête paginée', async () => {
    const { tx, execute } = txFactice({ selects: [[]] });
    const service = new ServiceArticle(accesFactice(tx), idempotenceFactice(tx));

    await expect(
      service.listerReferences(CTX, 'introuvable', { limite: 50, tri: 'creeLe:asc' }),
    ).rejects.toMatchObject({ code: 'RESSOURCE_INTROUVABLE' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('sous le seuil de page : pas de curseur suivant, toutes les références rendues', async () => {
    const { tx } = txFactice({
      selects: [[ligneArticle()]],
      executes: [
        {
          rows: [
            { ...ligneReference({ id: 'ref-1' }), triValeur: '2026-07-31 08:00:00.000000+00' },
            { ...ligneReference({ id: 'ref-2' }), triValeur: '2026-07-31 08:00:01.000000+00' },
          ],
        },
      ],
    });
    const service = new ServiceArticle(accesFactice(tx), idempotenceFactice(tx));

    const page = await service.listerReferences(CTX, 'a1', { limite: 50, tri: 'creeLe:asc' });

    expect(page.donnees).toHaveLength(2);
    expect(page.donnees.map((r) => r.id)).toEqual(['ref-1', 'ref-2']);
    expect(page.curseurSuivant).toBeNull();
  });

  it('au-delà du seuil de page : curseurSuivant non nul, la page ne rend que `limite` lignes', async () => {
    const { tx } = txFactice({
      selects: [[ligneArticle()]],
      executes: [
        {
          rows: [
            { ...ligneReference({ id: 'ref-1' }), triValeur: '2026-07-31 08:00:00.000000+00' },
            { ...ligneReference({ id: 'ref-2' }), triValeur: '2026-07-31 08:00:01.000000+00' },
          ],
        },
      ],
    });
    const service = new ServiceArticle(accesFactice(tx), idempotenceFactice(tx));

    const page = await service.listerReferences(CTX, 'a1', { limite: 1, tri: 'creeLe:asc' });

    expect(page.donnees).toHaveLength(1);
    expect(page.donnees[0]?.id).toBe('ref-1');
    expect(page.curseurSuivant).not.toBeNull();
  });

  it('la colonne `triValeur` est sélectionnée avec un cast ::text explicite, jamais laissée au parseur par défaut du pilote', async () => {
    const { tx, execute } = txFactice({ selects: [[ligneArticle()]], executes: [{ rows: [] }] });
    const service = new ServiceArticle(accesFactice(tx), idempotenceFactice(tx));

    await service.listerReferences(CTX, 'a1', { limite: 50, tri: 'creeLe:asc' });

    const appel = execute.mock.calls[0]?.[0] as SQL;
    const { sql: texte } = dialect.sqlToQuery(appel);
    expect(texte).toContain('(ar.cree_le)::text as "triValeur"');
  });

  it(
    'deux références partageant EXACTEMENT la même microseconde de création sortent tous les deux, ' +
      'sur deux pages successives, plutôt que de faire sauter la seconde page (le défaut historique ' +
      'du pilote `pg`, qui rend un `Date` tronqué à la milliseconde — `common/pagination/valeur-temporelle.ts`)',
    async () => {
      const MEME_INSTANT = '2026-07-29 13:37:35.171181+00';
      // `decoderCurseurTrie` valide `id` contre un format UUID (`REGEX_UUID`,
      // `common/pagination/curseur.ts`) — mêmes identifiants que `vehicules/service-vehicule.spec.ts`.
      const REF_1 = '11111111-1111-4111-8111-111111111111';
      const REF_2 = '22222222-2222-4222-8222-222222222222';
      const { tx } = txFactice({
        selects: [[ligneArticle()]],
        executes: [
          {
            rows: [
              { ...ligneReference({ id: REF_1 }), triValeur: MEME_INSTANT },
              { ...ligneReference({ id: REF_2 }), triValeur: MEME_INSTANT },
            ],
          },
        ],
      });
      const service = new ServiceArticle(accesFactice(tx), idempotenceFactice(tx));

      const page = await service.listerReferences(CTX, 'a1', { limite: 1, tri: 'creeLe:asc' });

      expect(page.donnees).toHaveLength(1);
      expect(page.curseurSuivant).not.toBeNull();
      // La régression : `new Date(MEME_INSTANT).toISOString()` tronque `.171181` en `.171`, et la
      // comparaison keyset SQL exclut alors TOUTE ligne à `.171181` (curseur < valeur réelle) — la
      // page 2 revenait vide. Le curseur encodé doit porter la microseconde intacte.
      const decode = decoderCurseurTrie(page.curseurSuivant as string, 'creeLe:asc');
      expect(decode.valeur).toBe('2026-07-29T13:37:35.171181+00:00');
      expect(decode.valeur).not.toBe(new Date(MEME_INSTANT).toISOString());
    },
  );
});
