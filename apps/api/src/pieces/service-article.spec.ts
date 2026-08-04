import { describe, expect, it, vi } from 'vitest';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import type {
  ReponseMemorisable,
  RequeteIdempotente,
  ResultatIdempotent,
  ServiceIdempotence,
} from '../common/idempotence';
import type { LigneArticle } from '../db/schema';
import { ServiceArticle } from './service-article';

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
function txFactice(plan: { selects?: readonly unknown[][] } = {}) {
  const selects = [...(plan.selects ?? [])];
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
  };

  return { tx: tx as unknown as TransactionDfa, setArgs, insertValuesArgs };
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
