import { describe, expect, it, vi } from 'vitest';
import type { EntreeCreationMouvementCasse, FiltresMouvementsStock } from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import type {
  ReponseMemorisable,
  RequeteIdempotente,
  ResultatIdempotent,
  ServiceIdempotence,
} from '../common/idempotence';
import type { LigneMouvementStock } from '../db/schema';
import { ServiceMouvement } from './service-mouvement';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };

function ligneMouvement(champs: Partial<LigneMouvementStock> = {}): LigneMouvementStock {
  return {
    id: 'm1',
    tenantId: 'tid-1',
    articleId: 'a1',
    type: 'casse',
    quantiteMillieme: -2000,
    siteId: 's1',
    siteSourceId: null,
    siteDestinationId: null,
    prixAchatReelCentimes: null,
    auteurId: 'u1',
    motif: 'Pièce tombée',
    ligneOrId: null,
    documentVenteLigneId: null,
    commandeFournisseurLigneId: null,
    inventaireReferenceId: null,
    reservationId: null,
    creeLe: new Date('2026-07-31T08:00:00.000Z'),
    ...champs,
  } as LigneMouvementStock;
}

/**
 * Fausse transaction : `select().from().where().limit()` rend, DANS L'ORDRE, les jeux fournis par
 * `selects` (utilisé par `chargerArticleOu404`/`chargerSiteOu404`) ; `execute()` rend, dans
 * l'ordre, les jeux fournis par `executes` (utilisé par `ServiceStock.chargerPourVerrou`) ;
 * `insert().values()` expose `.returning()`. Même patron que `clients/service-client.spec.ts`.
 */
function txFactice(
  plan: {
    selects?: readonly unknown[][];
    executes?: ReadonlyArray<{ rows: readonly unknown[] }>;
  } = {},
) {
  const selects = [...(plan.selects ?? [])];
  const executes = [...(plan.executes ?? [])];
  const insertsReturning: unknown[][] = [];
  const insertValuesArgs: Array<Record<string, unknown>> = [];

  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => Promise.resolve(selects.shift() ?? []) }),
      }),
    }),
    insert: (_table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        insertValuesArgs.push(vals);
        return { returning: () => Promise.resolve(insertsReturning.shift() ?? []) };
      },
    }),
    execute: vi.fn(() => Promise.resolve(executes.shift() ?? { rows: [] })),
  };

  return {
    tx: tx as unknown as TransactionDfa,
    insertValuesArgs,
    poserRetourInsert: (lignes: unknown[]) => insertsReturning.push(lignes),
  };
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

const ENTREE_CASSE: EntreeCreationMouvementCasse = {
  siteId: 's1',
  quantiteMillieme: 2000,
  motif: 'Pièce tombée en manipulation',
  forcer: false,
};

const FILTRES_DEFAUT: FiltresMouvementsStock = { limite: 50, tri: 'creeLe:desc' };

describe('ServiceMouvement.casse — RP-15/PP-02 : le disponible protège contre une sortie non couverte', () => {
  it('refuse (409 STOCK_INSUFFISANT) sans écrire de mouvement quand la quantité demandée dépasse le disponible', async () => {
    const { tx, insertValuesArgs } = txFactice({
      selects: [[{ id: 'a1' }], [{ id: 's1' }]],
      // physique 1000, réservée 0 → disponible 1000 < 2000 demandés.
      executes: [{ rows: [{ physique: 1000, reservee: 0 }] }],
    });
    const service = new ServiceMouvement(accesFactice(tx), idempotenceFactice(tx));

    await expect(
      service.casse(CTX, 'magasinier', 'a1', ENTREE_CASSE, 'idem-1'),
    ).rejects.toMatchObject({
      code: 'STOCK_INSUFFISANT',
      status: 409,
    });
    expect(insertValuesArgs).toHaveLength(0);
  });

  it('accepte quand le disponible couvre la quantité demandée, et insère un mouvement de quantité NÉGATIVE (RP-17, sortie)', async () => {
    const { tx, insertValuesArgs, poserRetourInsert } = txFactice({
      selects: [[{ id: 'a1' }], [{ id: 's1' }]],
      executes: [{ rows: [{ physique: 5000, reservee: 500 }] }], // disponible 4500 >= 2000
    });
    poserRetourInsert([ligneMouvement()]);
    const service = new ServiceMouvement(accesFactice(tx), idempotenceFactice(tx));

    const resultat = await service.casse(CTX, 'magasinier', 'a1', ENTREE_CASSE, 'idem-2');

    expect(resultat.reponse.statutHttp).toBe(201);
    expect(insertValuesArgs).toHaveLength(1);
    expect(insertValuesArgs[0]).toMatchObject({
      type: 'casse',
      quantiteMillieme: -2000,
      siteId: 's1',
      auteurId: 'u1',
    });
  });

  it('`forcer: true` contourne le refus STOCK_INSUFFISANT (RP-15, forçage journalisé)', async () => {
    const { tx, insertValuesArgs, poserRetourInsert } = txFactice({
      selects: [[{ id: 'a1' }], [{ id: 's1' }]],
      executes: [{ rows: [{ physique: 1000, reservee: 0 }] }], // disponible 1000 < 2000, mais forcer=true
    });
    poserRetourInsert([ligneMouvement()]);
    const service = new ServiceMouvement(accesFactice(tx), idempotenceFactice(tx));

    const resultat = await service.casse(
      CTX,
      'magasinier',
      'a1',
      { ...ENTREE_CASSE, forcer: true },
      'idem-3',
    );

    expect(resultat.reponse.statutHttp).toBe(201);
    expect(insertValuesArgs).toHaveLength(1);
  });
});

describe('ServiceMouvement.ajustementInventaire — §7.6 : un compte qui correspond déjà au stock ne crée aucun mouvement', () => {
  it('delta = 0 (compte = physique) : `donnees: null`, aucune ligne insérée (mouvement_stock_quantite_non_nulle_chk, 0025)', async () => {
    const { tx, insertValuesArgs } = txFactice({
      selects: [[{ id: 'a1', prixAchatCentimes: null }], [{ id: 's1' }]],
      executes: [{ rows: [{ physique: 3000, reservee: 0 }] }],
    });
    const service = new ServiceMouvement(accesFactice(tx), idempotenceFactice(tx));

    const resultat = await service.ajustementInventaire(
      CTX,
      'magasinier',
      'a1',
      { siteId: 's1', quantiteCompteeMillieme: 3000, motif: 'Inventaire annuel' },
      'idem-4',
    );

    expect(resultat.reponse.statutHttp).toBe(200);
    expect(resultat.reponse.corps.donnees).toBeNull();
    expect(insertValuesArgs).toHaveLength(0);
  });

  it('delta ≠ 0 : insère un mouvement `ajustement_inventaire` signé exactement du delta (compté - physique)', async () => {
    const { tx, insertValuesArgs, poserRetourInsert } = txFactice({
      selects: [[{ id: 'a1', prixAchatCentimes: null }], [{ id: 's1' }]],
      executes: [{ rows: [{ physique: 3000, reservee: 0 }] }],
    });
    poserRetourInsert([ligneMouvement({ type: 'ajustement_inventaire', quantiteMillieme: -500 })]);
    const service = new ServiceMouvement(accesFactice(tx), idempotenceFactice(tx));

    const resultat = await service.ajustementInventaire(
      CTX,
      'magasinier',
      'a1',
      { siteId: 's1', quantiteCompteeMillieme: 2500, motif: 'Inventaire annuel' },
      'idem-5',
    );

    expect(resultat.reponse.statutHttp).toBe(201);
    expect(insertValuesArgs[0]).toMatchObject({
      type: 'ajustement_inventaire',
      quantiteMillieme: -500,
    });
    expect(resultat.reponse.corps.donnees).not.toBeNull();
  });
});

describe('ServiceMouvement.lister — masquage de prixAchatReelCentimes par rôle (audit sécurité, RF-116/§11)', () => {
  /**
   * `lister` passe par `tx.execute()` (SQL brut), pas `select().from()` — voir l'en-tête du
   * fichier. `chargerArticleOu404` (appelé en tête de `lister`) utilise LUI le query-builder
   * (`selects`), donc les deux files coexistent dans le même plan.
   */
  function txListeFactice(lignes: readonly Partial<LigneMouvementStock>[]) {
    const executes: Array<{ rows: readonly unknown[] }> = [
      { rows: lignes.map((l) => ligneMouvement(l)) },
    ];
    const tx = {
      select: () => ({
        from: () => ({ where: () => ({ limit: () => Promise.resolve([{ id: 'a1' }]) }) }),
      }),
      execute: vi.fn(() => Promise.resolve(executes.shift() ?? { rows: [] })),
    };
    return tx as unknown as TransactionDfa;
  }

  const MOUVEMENT_ENTREE_LIVRAISON: Partial<LigneMouvementStock> = {
    type: 'entree_livraison',
    quantiteMillieme: 1000,
    prixAchatReelCentimes: 4200,
  };

  it('magasinier (rôle habilité, hors ROLES_SANS_PRIX_ACHAT_PIECES) : prixAchatReelCentimes est visible', async () => {
    const tx = txListeFactice([MOUVEMENT_ENTREE_LIVRAISON]);
    const service = new ServiceMouvement(accesFactice(tx), idempotenceFactice(tx));

    const page = await service.lister(CTX, 'magasinier', 'a1', FILTRES_DEFAUT);

    expect(page.donnees[0]?.prixAchatReelCentimes).toBe(4200);
  });

  it('PREUVE PAR FALSIFICATION — technicien (ROLES_SANS_PRIX_ACHAT_PIECES) : prixAchatReelCentimes est masqué (null), jamais la valeur brute', async () => {
    const tx = txListeFactice([MOUVEMENT_ENTREE_LIVRAISON]);
    const service = new ServiceMouvement(accesFactice(tx), idempotenceFactice(tx));

    const page = await service.lister(CTX, 'technicien', 'a1', FILTRES_DEFAUT);

    // Falsifiable : si `versMouvementResponse` cesse de masquer selon le rôle (régression du
    // correctif d'audit), cette assertion échoue — `donnees[0].prixAchatReelCentimes` redevient
    // 4200 au lieu de `null`. Vérifié manuellement en retirant temporairement le masquage de
    // `mappers.ts::versMouvementResponse` : ce test rougit, `4200 !== null` — voir le rapport de
    // livraison pour la preuve d'exécution.
    expect(page.donnees[0]?.prixAchatReelCentimes).toBeNull();
  });

  it('vendeur, receptionnaire, admin : même masquage (ROLES_SANS_PRIX_ACHAT_PIECES complet)', async () => {
    for (const role of ['vendeur', 'receptionnaire', 'admin'] as const) {
      const tx = txListeFactice([MOUVEMENT_ENTREE_LIVRAISON]);
      const service = new ServiceMouvement(accesFactice(tx), idempotenceFactice(tx));
      const page = await service.lister(CTX, role, 'a1', FILTRES_DEFAUT);
      expect(page.donnees[0]?.prixAchatReelCentimes).toBeNull();
    }
  });

  it('un mouvement sans prix (casse, perte…) reste `null` quel que soit le rôle — le masquage ne fabrique jamais une distinction inverse', async () => {
    const tx = txListeFactice([{ type: 'casse', prixAchatReelCentimes: null }]);
    const service = new ServiceMouvement(accesFactice(tx), idempotenceFactice(tx));

    const page = await service.lister(CTX, 'magasinier', 'a1', FILTRES_DEFAUT);

    expect(page.donnees[0]?.prixAchatReelCentimes).toBeNull();
  });
});
