import { describe, expect, it, vi } from 'vitest';
import type {
  EntreeCreationMouvementCasse,
  EntreeCreationMouvementRetourClient,
  EntreeCreationMouvementSortieComptoir,
  FiltresMouvementsStock,
} from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import type {
  ReponseMemorisable,
  RequeteIdempotente,
  ResultatIdempotent,
  ServiceIdempotence,
} from '../common/idempotence';
import type { LigneMouvementStock } from '../db/schema';
import { ServiceMouvement } from './service-mouvement';
import type { ServiceReservation } from './service-reservation';

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

/**
 * Stub de `ServiceReservation` injecté (0047, cascade de libération forcée) : `libererPourCascade
 * ForcageTx` en no-op silencieux (`[]`, aucune réservation à libérer) — c'est le comportement
 * réellement exercé par TOUS les tests de ce fichier : `libererCascadeSiNecessaire`
 * (`service-mouvement.ts`) ne l'appelle QUE quand `reservee > max(physiqueApres, 0)`, et chaque
 * `executes` de ce fichier pose `reservee: 0`, donc `max(physiqueApres, 0) >= 0 = reservee`
 * TOUJOURS — la branche retourne avant d'atteindre `ServiceReservation`. Seul
 * `service-reservation.spec.ts` exerce `libererPourCascadeForcageTx` lui-même ; l'intégration
 * complète (cascade RÉELLE, contrainte SQL relâchée par 0047) est prouvée par
 * `test/lot2/pieces/pont-atelier-pieces.spec.ts`, section `pieces.mouvement.forcer`.
 */
function reservationFactice(
  apercu: ReadonlyArray<{
    id: string;
    ligneOrId: string;
    ordreReparationId: string;
    ordreReparationNumero: string;
    quantiteMillieme: number;
  }> = [],
): ServiceReservation {
  return {
    libererPourCascadeForcageTx: vi.fn(async () => []),
    apercuLiberationCascadeTx: vi.fn(async () => apercu),
  } as unknown as ServiceReservation;
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

/**
 * Fausse idempotence AVEC déduplication réelle par clé — à la différence de `idempotenceFactice`
 * ci-dessus (qui exécute `travail` inconditionnellement), celle-ci simule le comportement RÉEL du
 * service d'idempotence : `travail` ne s'exécute qu'une fois par clé, tout appel suivant avec la
 * même clé rend la réponse mémorisée avec `rejoue: true`, SANS ré-invoquer `travail`. C'est le
 * comportement que `deux appels avec la même clé = un seul mouvement` doit observer.
 */
function idempotenceAvecCache(tx: TransactionDfa): {
  service: ServiceIdempotence;
  compteurAppelsTravail: () => number;
} {
  const cache = new Map<string, unknown>();
  let appels = 0;
  const service: ServiceIdempotence = {
    async executer<T extends ReponseMemorisable>(
      _ctx: ContexteTenant,
      requete: RequeteIdempotente,
      travail: (tx: TransactionDfa) => Promise<T>,
    ): Promise<ResultatIdempotent<T>> {
      const existante = cache.get(requete.cle);
      if (existante !== undefined) {
        return { reponse: existante as T, rejoue: true };
      }
      appels += 1;
      const reponse = await travail(tx);
      cache.set(requete.cle, reponse);
      return { reponse, rejoue: false };
    },
  };
  return { service, compteurAppelsTravail: () => appels };
}

const ENTREE_SORTIE_COMPTOIR: EntreeCreationMouvementSortieComptoir = {
  siteId: 's1',
  quantiteMillieme: 3000,
};

const ENTREE_RETOUR_CLIENT: EntreeCreationMouvementRetourClient = {
  siteId: 's1',
  quantiteMillieme: 1000,
  motif: 'Pièce non montée, client la rapporte le jour même',
};

describe('ServiceMouvement.sortieComptoir — ouvre la vente directe au comptoir (trou fonctionnel comblé)', () => {
  it('sortie nominale : mouvement `sortie_comptoir` de quantité NÉGATIVE, motif absent stocké `null`', async () => {
    const { tx, insertValuesArgs, poserRetourInsert } = txFactice({
      selects: [[{ id: 'a1' }], [{ id: 's1' }]],
      executes: [{ rows: [{ physique: 5000, reservee: 0 }] }], // disponible 5000 >= 3000
    });
    poserRetourInsert([
      ligneMouvement({ type: 'sortie_comptoir', quantiteMillieme: -3000, motif: null }),
    ]);
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

    const resultat = await service.sortieComptoir(
      CTX,
      'magasinier',
      'a1',
      ENTREE_SORTIE_COMPTOIR,
      'idem-sc-1',
    );

    expect(resultat.reponse.statutHttp).toBe(201);
    expect(insertValuesArgs).toHaveLength(1);
    expect(insertValuesArgs[0]).toMatchObject({
      type: 'sortie_comptoir',
      quantiteMillieme: -3000,
      siteId: 's1',
      motif: null,
      auteurId: 'u1',
    });
  });

  it('stock insuffisant : refuse (409 STOCK_INSUFFISANT), aucun mouvement écrit — JAMAIS un 500 (pas de `forcer` sur cette route)', async () => {
    const { tx, insertValuesArgs } = txFactice({
      selects: [[{ id: 'a1' }], [{ id: 's1' }]],
      // physique 2000, réservée 500 → disponible 1500 < 3000 demandés.
      executes: [{ rows: [{ physique: 2000, reservee: 500 }] }],
    });
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

    await expect(
      service.sortieComptoir(CTX, 'magasinier', 'a1', ENTREE_SORTIE_COMPTOIR, 'idem-sc-2'),
    ).rejects.toMatchObject({ code: 'STOCK_INSUFFISANT', status: 409 });
    expect(insertValuesArgs).toHaveLength(0);
  });

  it('isolation tenant : le mouvement créé porte le tenant de la session appelante', async () => {
    const { tx, insertValuesArgs, poserRetourInsert } = txFactice({
      selects: [[{ id: 'a1' }], [{ id: 's1' }]],
      executes: [{ rows: [{ physique: 5000, reservee: 0 }] }],
    });
    poserRetourInsert([ligneMouvement({ type: 'sortie_comptoir', quantiteMillieme: -3000 })]);
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

    await service.sortieComptoir(CTX, 'magasinier', 'a1', ENTREE_SORTIE_COMPTOIR, 'idem-sc-3');

    expect(insertValuesArgs[0]).toMatchObject({ tenantId: 'tid-1' });
  });

  it('isolation tenant : un article inexistant POUR CE TENANT (RLS) est refusé 404, jamais servi depuis un autre tenant', async () => {
    const { tx, insertValuesArgs } = txFactice({
      selects: [[]], // chargerArticleOu404 : aucune ligne pour (tenantId, articleId)
    });
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

    await expect(
      service.sortieComptoir(CTX, 'magasinier', 'a1', ENTREE_SORTIE_COMPTOIR, 'idem-sc-4'),
    ).rejects.toMatchObject({ code: 'RESSOURCE_INTROUVABLE', status: 404 });
    expect(insertValuesArgs).toHaveLength(0);
  });

  it('idempotence : deux appels avec la MÊME clé ne créent qu’UN SEUL mouvement (double-clic magasinier)', async () => {
    const { tx, insertValuesArgs, poserRetourInsert } = txFactice({
      selects: [[{ id: 'a1' }], [{ id: 's1' }]],
      executes: [{ rows: [{ physique: 5000, reservee: 0 }] }],
    });
    poserRetourInsert([
      ligneMouvement({ id: 'm-sc-1', type: 'sortie_comptoir', quantiteMillieme: -3000 }),
    ]);
    const { service: idempotence, compteurAppelsTravail } = idempotenceAvecCache(tx);
    const service = new ServiceMouvement(accesFactice(tx), idempotence, reservationFactice());

    const premier = await service.sortieComptoir(
      CTX,
      'magasinier',
      'a1',
      ENTREE_SORTIE_COMPTOIR,
      'meme-cle-idempotence',
    );
    const second = await service.sortieComptoir(
      CTX,
      'magasinier',
      'a1',
      ENTREE_SORTIE_COMPTOIR,
      'meme-cle-idempotence',
    );

    expect(compteurAppelsTravail()).toBe(1);
    expect(insertValuesArgs).toHaveLength(1);
    expect(premier.rejoue).toBe(false);
    expect(second.rejoue).toBe(true);
    expect(second.reponse.corps.id).toBe(premier.reponse.corps.id);
  });
});

describe('ServiceMouvement.retourClient — le client rapporte une pièce, remise en stock (RP-17)', () => {
  it('remet la quantité en stock PHYSIQUE (mouvement `+`, jamais négatif), motif obligatoire porté', async () => {
    const { tx, insertValuesArgs, poserRetourInsert } = txFactice({
      selects: [[{ id: 'a1' }], [{ id: 's1' }]],
      // aucune vérification de disponibilité pour une ENTRÉE : pas d'`executes` consommé ici.
    });
    poserRetourInsert([
      ligneMouvement({
        type: 'retour_client',
        quantiteMillieme: 1000,
        motif: ENTREE_RETOUR_CLIENT.motif,
      }),
    ]);
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

    const resultat = await service.retourClient(
      CTX,
      'magasinier',
      'a1',
      ENTREE_RETOUR_CLIENT,
      'idem-rc-1',
    );

    expect(resultat.reponse.statutHttp).toBe(201);
    expect(insertValuesArgs).toHaveLength(1);
    expect(insertValuesArgs[0]).toMatchObject({
      type: 'retour_client',
      quantiteMillieme: 1000,
      siteId: 's1',
      motif: ENTREE_RETOUR_CLIENT.motif,
      auteurId: 'u1',
    });
    // le trigger `mouvement_stock_appliquer_physique` (0025/0040) applique ce delta SIGNÉ POSITIF
    // à `stock_article.quantite_physique_millieme` — non ré-exercé ici (mécanique base, hors
    // périmètre unitaire), juste la garantie que ce service N'ENVOIE PAS de delta négatif.
    expect((insertValuesArgs[0]?.quantiteMillieme as number) > 0).toBe(true);
  });

  it('isolation tenant : le mouvement créé porte le tenant de la session appelante', async () => {
    const { tx, insertValuesArgs, poserRetourInsert } = txFactice({
      selects: [[{ id: 'a1' }], [{ id: 's1' }]],
    });
    poserRetourInsert([ligneMouvement({ type: 'retour_client', quantiteMillieme: 1000 })]);
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

    await service.retourClient(CTX, 'magasinier', 'a1', ENTREE_RETOUR_CLIENT, 'idem-rc-2');

    expect(insertValuesArgs[0]).toMatchObject({ tenantId: 'tid-1' });
  });

  it('idempotence : deux appels avec la MÊME clé ne créent qu’UN SEUL mouvement', async () => {
    const { tx, insertValuesArgs, poserRetourInsert } = txFactice({
      selects: [[{ id: 'a1' }], [{ id: 's1' }]],
    });
    poserRetourInsert([
      ligneMouvement({ id: 'm-rc-1', type: 'retour_client', quantiteMillieme: 1000 }),
    ]);
    const { service: idempotence, compteurAppelsTravail } = idempotenceAvecCache(tx);
    const service = new ServiceMouvement(accesFactice(tx), idempotence, reservationFactice());

    const premier = await service.retourClient(
      CTX,
      'magasinier',
      'a1',
      ENTREE_RETOUR_CLIENT,
      'meme-cle-idempotence-rc',
    );
    const second = await service.retourClient(
      CTX,
      'magasinier',
      'a1',
      ENTREE_RETOUR_CLIENT,
      'meme-cle-idempotence-rc',
    );

    expect(compteurAppelsTravail()).toBe(1);
    expect(insertValuesArgs).toHaveLength(1);
    expect(premier.rejoue).toBe(false);
    expect(second.rejoue).toBe(true);
  });

  it('404 : un article introuvable pour ce tenant est refusé avant toute écriture', async () => {
    const { tx, insertValuesArgs } = txFactice({
      selects: [[]],
    });
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

    await expect(
      service.retourClient(CTX, 'magasinier', 'a1', ENTREE_RETOUR_CLIENT, 'idem-rc-3'),
    ).rejects.toMatchObject({ code: 'RESSOURCE_INTROUVABLE', status: 404 });
    expect(insertValuesArgs).toHaveLength(0);
  });
});

const FILTRES_DEFAUT: FiltresMouvementsStock = { limite: 50, tri: 'creeLe:desc' };

describe('ServiceMouvement.casse — RP-15/PP-02 : le disponible protège contre une sortie non couverte', () => {
  it('refuse (409 STOCK_INSUFFISANT) sans écrire de mouvement quand la quantité demandée dépasse le disponible', async () => {
    const { tx, insertValuesArgs } = txFactice({
      selects: [[{ id: 'a1' }], [{ id: 's1' }]],
      // physique 1000, réservée 0 → disponible 1000 < 2000 demandés.
      executes: [{ rows: [{ physique: 1000, reservee: 0 }] }],
    });
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

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
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

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
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

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

describe('ServiceMouvement — pieces.mouvement.forcer (audit sécurité, forcer dissocié de pieces.mouvement.creer)', () => {
  it('`forcer: true` par un rôle SANS pieces.mouvement.forcer (technicien) est refusé 403 DROIT_INSUFFISANT, AUCUN accès base', async () => {
    const { tx, insertValuesArgs } = txFactice({
      // Aucun `selects`/`executes` posé : la preuve que le refus intervient AVANT tout accès base
      // (chargerArticleOu404 inclus) est que consommer un jeu vide ferait échouer le test par une
      // erreur différente (undefined) plutôt que par le rejet attendu — voir l'assertion ci-dessous.
    });
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

    await expect(
      service.casse(CTX, 'technicien', 'a1', { ...ENTREE_CASSE, forcer: true }, 'idem-forcer-1'),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT', status: 403 });
    expect(insertValuesArgs).toHaveLength(0);
  });

  it('`perte` avec `forcer: true` par un rôle sans le droit est refusé de la même façon (même garde que casse)', async () => {
    const { tx, insertValuesArgs } = txFactice({});
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

    await expect(
      service.perte(CTX, 'chef_atelier', 'a1', { ...ENTREE_CASSE, forcer: true }, 'idem-forcer-2'),
    ).rejects.toMatchObject({ code: 'DROIT_INSUFFISANT', status: 403 });
    expect(insertValuesArgs).toHaveLength(0);
  });

  it('le MÊME rôle sans pieces.mouvement.forcer continue de fonctionner SANS forcer (non-régression : seul le forçage est gouverné, jamais la création normale)', async () => {
    const { tx, insertValuesArgs, poserRetourInsert } = txFactice({
      selects: [[{ id: 'a1' }], [{ id: 's1' }]],
      executes: [{ rows: [{ physique: 5000, reservee: 0 }] }], // disponible 5000 >= 2000, pas besoin de forcer
    });
    poserRetourInsert([ligneMouvement()]);
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

    const resultat = await service.casse(
      CTX,
      'technicien',
      'a1',
      { ...ENTREE_CASSE, forcer: false },
      'idem-forcer-3',
    );

    expect(resultat.reponse.statutHttp).toBe(201);
    expect(insertValuesArgs).toHaveLength(1);
  });

  it('le MÊME rôle sans pieces.mouvement.forcer, sans forcer, reçoit toujours 409 STOCK_INSUFFISANT quand le stock manque (le droit ne change rien au refus normal)', async () => {
    const { tx, insertValuesArgs } = txFactice({
      selects: [[{ id: 'a1' }], [{ id: 's1' }]],
      executes: [{ rows: [{ physique: 500, reservee: 0 }] }], // disponible 500 < 2000
    });
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

    await expect(
      service.casse(CTX, 'technicien', 'a1', { ...ENTREE_CASSE, forcer: false }, 'idem-forcer-4'),
    ).rejects.toMatchObject({ code: 'STOCK_INSUFFISANT', status: 409 });
    expect(insertValuesArgs).toHaveLength(0);
  });

  it('magasinier (a pieces.mouvement.forcer) : `forcer: true` reste accepté — non-régression du geste légitime déjà couvert plus haut', async () => {
    const { tx, insertValuesArgs, poserRetourInsert } = txFactice({
      selects: [[{ id: 'a1' }], [{ id: 's1' }]],
      executes: [{ rows: [{ physique: 1000, reservee: 0 }] }], // disponible 1000 < 2000, forcer=true couvre
    });
    poserRetourInsert([ligneMouvement()]);
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

    const resultat = await service.perte(
      CTX,
      'magasinier',
      'a1',
      { ...ENTREE_CASSE, forcer: true },
      'idem-forcer-5',
    );

    expect(resultat.reponse.statutHttp).toBe(201);
    expect(insertValuesArgs).toHaveLength(1);
  });
});

describe('ServiceMouvement.apercuForcage — défaut n°2 (test manuel du 14.08.2026), avertissement AVANT le forçage', () => {
  it('stock disponible suffisant pour la quantité demandée : `reservations: []`, AUCUN appel à `apercuLiberationCascadeTx` (le forçage ne changerait rien)', async () => {
    const { tx } = txFactice({
      // 3e jeu (`stock_article`, lu par `.select().from(stockArticle)`, PAS `.execute()` — lecture
      // NON verrouillante délibérée, voir la doc de `apercuForcage`) : physique=5000, reservee=0.
      selects: [[{ id: 'a1' }], [{ id: 's1' }], [{ physique: 5000, reservee: 0 }]],
    });
    const reservation = reservationFactice();
    const service = new ServiceMouvement(accesFactice(tx), idempotenceFactice(tx), reservation);

    const resultat = await service.apercuForcage(CTX, 'a1', {
      siteId: 's1',
      quantiteMillieme: 2000,
    });

    expect(resultat).toEqual({ reservations: [] });
    expect(reservation.apercuLiberationCascadeTx).not.toHaveBeenCalled();
  });

  it('stock insuffisant, aucune réservation active à couvrir le déficit : `reservations: []`', async () => {
    const { tx } = txFactice({
      // disponible 1000 < 2000, mais reservee=0 -> rien à libérer.
      selects: [[{ id: 'a1' }], [{ id: 's1' }], [{ physique: 1000, reservee: 0 }]],
    });
    const reservation = reservationFactice([]);
    const service = new ServiceMouvement(accesFactice(tx), idempotenceFactice(tx), reservation);

    const resultat = await service.apercuForcage(CTX, 'a1', {
      siteId: 's1',
      quantiteMillieme: 2000,
    });

    expect(resultat).toEqual({ reservations: [] });
    expect(reservation.apercuLiberationCascadeTx).not.toHaveBeenCalled();
  });

  it('stock insuffisant ET des réservations actives seraient libérées : rend la liste CHIFFRÉE (id, OR, numéro, quantité) — l’avertissement spécifique exigé par RP-15, AVANT toute soumission', async () => {
    const { tx } = txFactice({
      // physique=1000, reservee=800 -> disponible=200 < 2000 demandé -> physiqueApres = 1000-2000 =
      // -1000 -> plafondReservee = max(-1000, 0) = 0 -> aLiberer = 800 - 0 = 800.
      selects: [[{ id: 'a1' }], [{ id: 's1' }], [{ physique: 1000, reservee: 800 }]],
    });
    const reservation = reservationFactice([
      {
        id: 'resa-1',
        ligneOrId: 'ligne-1',
        ordreReparationId: 'or-1',
        ordreReparationNumero: 'OR-2026-0042',
        quantiteMillieme: 800,
      },
    ]);
    const service = new ServiceMouvement(accesFactice(tx), idempotenceFactice(tx), reservation);

    const resultat = await service.apercuForcage(CTX, 'a1', {
      siteId: 's1',
      quantiteMillieme: 2000,
    });

    expect(resultat).toEqual({
      reservations: [
        {
          id: 'resa-1',
          ligneOrId: 'ligne-1',
          ordreReparationId: 'or-1',
          ordreReparationNumero: 'OR-2026-0042',
          quantiteMillieme: 800,
        },
      ],
    });
    expect(reservation.apercuLiberationCascadeTx).toHaveBeenCalledWith(
      expect.anything(),
      CTX,
      'a1',
      's1',
      800,
    );
  });

  it('aucune ligne `stock_article` pour cet (article, site) : physique/réservé traités comme 0, jamais un accès base qui plante', async () => {
    const { tx } = txFactice({
      selects: [[{ id: 'a1' }], [{ id: 's1' }], []], // aucune ligne stock_article
    });
    const reservation = reservationFactice();
    const service = new ServiceMouvement(accesFactice(tx), idempotenceFactice(tx), reservation);

    const resultat = await service.apercuForcage(CTX, 'a1', {
      siteId: 's1',
      quantiteMillieme: 1000,
    });

    // physique=0, reservee=0 -> disponible=0 < 1000 -> physiqueApres=-1000 -> plafond=0 -> aLiberer=0
    // -> rien à couvrir, AUCUNE réservation à libérer (il n'y en a par définition aucune).
    expect(resultat).toEqual({ reservations: [] });
  });
});

describe('ServiceMouvement.sortieComptoirPourLigneTx — pont facturation (RP-43), variante composable', () => {
  it('nominal : mouvement `sortie_comptoir` créé avec `documentVenteLigneId` renseigné, quantité NÉGATIVE, dans le `tx` fourni (pas de nouvelle transaction)', async () => {
    const { tx, insertValuesArgs, poserRetourInsert } = txFactice({
      selects: [[{ id: 'a1' }], [{ id: 's1' }]],
      executes: [{ rows: [{ physique: 5000, reservee: 0 }] }],
    });
    poserRetourInsert([
      ligneMouvement({
        type: 'sortie_comptoir',
        quantiteMillieme: -1000,
        documentVenteLigneId: 'ligne-doc-1',
      }),
    ]);
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

    const reponse = await service.sortieComptoirPourLigneTx(tx, CTX, 'vendeur', {
      articleId: 'a1',
      siteId: 's1',
      quantiteMillieme: 1000,
      documentVenteLigneId: 'ligne-doc-1',
      motif: null,
    });

    expect(reponse.type).toBe('sortie_comptoir');
    expect(insertValuesArgs).toHaveLength(1);
    expect(insertValuesArgs[0]).toMatchObject({
      type: 'sortie_comptoir',
      quantiteMillieme: -1000,
      siteId: 's1',
      documentVenteLigneId: 'ligne-doc-1',
      auteurId: 'u1',
    });
  });

  it('stock insuffisant : rejette 409 STOCK_INSUFFISANT, AUCUN mouvement écrit — la ligne de document appelante doit alors échouer avec (atomicité prouvée côté service-documents.spec.ts)', async () => {
    const { tx, insertValuesArgs } = txFactice({
      selects: [[{ id: 'a1' }], [{ id: 's1' }]],
      executes: [{ rows: [{ physique: 500, reservee: 0 }] }], // disponible 500 < 1000
    });
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

    await expect(
      service.sortieComptoirPourLigneTx(tx, CTX, 'vendeur', {
        articleId: 'a1',
        siteId: 's1',
        quantiteMillieme: 1000,
        documentVenteLigneId: 'ligne-doc-2',
        motif: null,
      }),
    ).rejects.toMatchObject({ code: 'STOCK_INSUFFISANT', status: 409 });
    expect(insertValuesArgs).toHaveLength(0);
  });
});

describe('ServiceMouvement.retourClientPourLigneTx — pont facturation (RP-46), variante composable', () => {
  it('nominal : mouvement `retour_client` créé avec `documentVenteLigneId` renseigné (ligne de l’AVOIR), quantité POSITIVE', async () => {
    const { tx, insertValuesArgs, poserRetourInsert } = txFactice({
      selects: [[{ id: 'a1' }], [{ id: 's1' }]],
    });
    poserRetourInsert([
      ligneMouvement({
        type: 'retour_client',
        quantiteMillieme: 1000,
        documentVenteLigneId: 'ligne-avoir-1',
      }),
    ]);
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

    const reponse = await service.retourClientPourLigneTx(tx, CTX, 'direction', {
      articleId: 'a1',
      siteId: 's1',
      quantiteMillieme: 1000,
      documentVenteLigneId: 'ligne-avoir-1',
      motif: 'Retour client — avoir sur facture 2026-00042 (RP-46).',
    });

    expect(reponse.type).toBe('retour_client');
    expect(insertValuesArgs).toHaveLength(1);
    expect(insertValuesArgs[0]).toMatchObject({
      type: 'retour_client',
      quantiteMillieme: 1000,
      siteId: 's1',
      documentVenteLigneId: 'ligne-avoir-1',
    });
    expect((insertValuesArgs[0]?.quantiteMillieme as number) > 0).toBe(true);
  });
});

describe('ServiceMouvement.trouverMouvementParLigneDocumentTx — retrouve le mouvement lié à une ligne de document', () => {
  it('rend le mouvement quand `document_vente_ligne_id` correspond', async () => {
    const executes = [
      { rows: [ligneMouvement({ type: 'sortie_comptoir', documentVenteLigneId: 'ligne-doc-9' })] },
    ];
    const tx = {
      execute: vi.fn(() => Promise.resolve(executes.shift() ?? { rows: [] })),
    } as unknown as TransactionDfa;
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

    const mouvement = await service.trouverMouvementParLigneDocumentTx(tx, CTX, 'ligne-doc-9');

    expect(mouvement?.documentVenteLigneId).toBe('ligne-doc-9');
  });

  it('rend `null` quand aucun mouvement ne référence cette ligne (cas normal : ligne sans article, forfait, main d’œuvre…)', async () => {
    const tx = { execute: vi.fn(() => Promise.resolve({ rows: [] })) } as unknown as TransactionDfa;
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

    const mouvement = await service.trouverMouvementParLigneDocumentTx(
      tx,
      CTX,
      'ligne-doc-inexistante',
    );

    expect(mouvement).toBeNull();
  });
});

describe('ServiceMouvement.ajustementInventaire — §7.6 : un compte qui correspond déjà au stock ne crée aucun mouvement', () => {
  it('delta = 0 (compte = physique) : `donnees: null`, aucune ligne insérée (mouvement_stock_quantite_non_nulle_chk, 0025)', async () => {
    const { tx, insertValuesArgs } = txFactice({
      selects: [[{ id: 'a1', prixAchatCentimes: null }], [{ id: 's1' }]],
      executes: [{ rows: [{ physique: 3000, reservee: 0 }] }],
    });
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

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
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

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
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

    const page = await service.lister(CTX, 'magasinier', 'a1', FILTRES_DEFAUT);

    expect(page.donnees[0]?.prixAchatReelCentimes).toBe(4200);
  });

  it('PREUVE PAR FALSIFICATION — technicien (ROLES_SANS_PRIX_ACHAT_PIECES) : prixAchatReelCentimes est masqué (null), jamais la valeur brute', async () => {
    const tx = txListeFactice([MOUVEMENT_ENTREE_LIVRAISON]);
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

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
      const service = new ServiceMouvement(
        accesFactice(tx),
        idempotenceFactice(tx),
        reservationFactice(),
      );
      const page = await service.lister(CTX, role, 'a1', FILTRES_DEFAUT);
      expect(page.donnees[0]?.prixAchatReelCentimes).toBeNull();
    }
  });

  it('un mouvement sans prix (casse, perte…) reste `null` quel que soit le rôle — le masquage ne fabrique jamais une distinction inverse', async () => {
    const tx = txListeFactice([{ type: 'casse', prixAchatReelCentimes: null }]);
    const service = new ServiceMouvement(
      accesFactice(tx),
      idempotenceFactice(tx),
      reservationFactice(),
    );

    const page = await service.lister(CTX, 'magasinier', 'a1', FILTRES_DEFAUT);

    expect(page.donnees[0]?.prixAchatReelCentimes).toBeNull();
  });
});
