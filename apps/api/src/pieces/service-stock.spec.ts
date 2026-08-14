import { describe, expect, it, vi } from 'vitest';
import { schemaModificationStockSite, SEUIL_RESERVATIONS_DISPONIBILITE } from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import type { LigneStockArticle } from '../db/schema';
import { ServiceStock } from './service-stock';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };

function ligneStock(champs: Partial<LigneStockArticle> = {}): LigneStockArticle {
  return {
    tenantId: 'tid-1',
    articleId: 'a1',
    siteId: 's1',
    quantitePhysiqueMillieme: 5000,
    quantiteReserveeMillieme: 1000,
    emplacement: 'B3',
    // Casier structuré (0056) : `null` par défaut dans la fixture — un article sans casier
    // renseigné reste un état parfaitement valide (voir le describe dédié plus bas).
    rayon: null,
    tiroir: null,
    stockMinimumMillieme: null,
    quantiteCommandeStandardMillieme: null,
    creeLe: new Date('2026-07-31T08:00:00.000Z'),
    modifieLe: new Date('2026-07-31T08:00:00.000Z'),
    ...champs,
  } as LigneStockArticle;
}

function reservationActive(rang: number) {
  return {
    reservationId: `r${String(rang)}`,
    ligneOrId: `lo${String(rang)}`,
    ordreReparationId: `or${String(rang)}`,
    numeroOrdreReparation: `OR-${String(1000 + rang)}`,
    clientNomAffichage: 'Dupont Jean',
    quantiteMillieme: 100,
    reserveeLe: new Date('2026-07-31T08:00:00.000Z'),
  };
}

function txFactice(
  plan: {
    selects?: readonly unknown[][];
    executes?: ReadonlyArray<{ rows: readonly unknown[] }>;
  } = {},
) {
  const selects = [...(plan.selects ?? [])];
  const executes = [...(plan.executes ?? [])];
  const onConflictArgs: unknown[] = [];
  const insertValues: unknown[] = [];

  const tx = {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(selects.shift() ?? []) }) }),
    }),
    insert: (_table: unknown) => ({
      values: (vals: unknown) => {
        insertValues.push(vals);
        return {
          onConflictDoUpdate: (args: unknown) => {
            onConflictArgs.push(args);
            return Promise.resolve(undefined);
          },
        };
      },
    }),
    execute: vi.fn(() => Promise.resolve(executes.shift() ?? { rows: [] })),
  };

  return { tx: tx as unknown as TransactionDfa, onConflictArgs, insertValues };
}

function accesFactice(tx: TransactionDfa): AccesBase {
  return {
    enTenant: vi.fn((_ctx, travail) => travail(tx)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
}

describe('ServiceStock.disponibilite — RP-14 : quantiteDisponible est TOUJOURS dérivé, jamais stocké', () => {
  it('aucune ligne stock_article pour ce (article, site) : disponible = 0, jamais une exception', async () => {
    const { tx } = txFactice({ selects: [[{ id: 'a1' }], []], executes: [{ rows: [] }] });
    const service = new ServiceStock(accesFactice(tx));

    const resultat = await service.disponibilite(CTX, 'a1', 's1');

    expect(resultat.quantitePhysiqueMillieme).toBe(0);
    expect(resultat.quantiteReserveeMillieme).toBe(0);
    expect(resultat.quantiteDisponibleMillieme).toBe(0);
    expect(resultat.reservationsActives).toHaveLength(0);
  });

  it('quantiteDisponible = physique - réservée, réservations actives nommées, jamais tronquées sous le seuil', async () => {
    const { tx } = txFactice({
      selects: [[{ id: 'a1' }], [ligneStock()]],
      executes: [{ rows: [reservationActive(1), reservationActive(2)] }],
    });
    const service = new ServiceStock(accesFactice(tx));

    const resultat = await service.disponibilite(CTX, 'a1', 's1');

    expect(resultat.quantiteDisponibleMillieme).toBe(4000); // 5000 - 1000
    expect(resultat.reservationsActives).toHaveLength(2);
    expect(resultat.reservationsActivesTronquees).toBe(false);
  });

  it(`tronque à ${String(SEUIL_RESERVATIONS_DISPONIBILITE)} réservations actives et signale reservationsActivesTronquees: true`, async () => {
    const lignesEnTrop = Array.from({ length: SEUIL_RESERVATIONS_DISPONIBILITE + 1 }, (_, i) =>
      reservationActive(i),
    );
    const { tx } = txFactice({
      selects: [[{ id: 'a1' }], [ligneStock()]],
      executes: [{ rows: lignesEnTrop }],
    });
    const service = new ServiceStock(accesFactice(tx));

    const resultat = await service.disponibilite(CTX, 'a1', 's1');

    expect(resultat.reservationsActives).toHaveLength(SEUIL_RESERVATIONS_DISPONIBILITE);
    expect(resultat.reservationsActivesTronquees).toBe(true);
  });
});

describe('ServiceStock.modifierSite — réglages de site, jamais la quantité physique', () => {
  it('upsert sur (tenant, article, site) : crée la ligne si absente (physique reste au défaut 0)', async () => {
    const { tx, onConflictArgs } = txFactice({
      selects: [
        [{ id: 'a1' }],
        [{ id: 's1' }],
        [
          ligneStock({
            emplacement: 'C4',
            quantitePhysiqueMillieme: 0,
            quantiteReserveeMillieme: 0,
          }),
        ],
      ],
    });
    const service = new ServiceStock(accesFactice(tx));

    const resultat = await service.modifierSite(CTX, 'a1', 's1', { emplacement: 'C4' });

    expect(onConflictArgs).toHaveLength(1);
    expect(resultat.emplacement).toBe('C4');
    expect(resultat.quantitePhysiqueMillieme).toBe(0);
  });

  it('rayon/tiroir écrits dans les valeurs upsert, tenantId toujours celui du contexte (isolation tenant)', async () => {
    const { tx, insertValues } = txFactice({
      selects: [[{ id: 'a1' }], [{ id: 's1' }], [ligneStock({ rayon: 'B3', tiroir: '2' })]],
    });
    const service = new ServiceStock(accesFactice(tx));

    const resultat = await service.modifierSite(CTX, 'a1', 's1', { rayon: 'B3', tiroir: '2' });

    expect(insertValues).toHaveLength(1);
    expect(insertValues[0]).toMatchObject({
      tenantId: CTX.tenantId,
      articleId: 'a1',
      siteId: 's1',
      rayon: 'B3',
      tiroir: '2',
    });
    expect(resultat.rayon).toBe('B3');
    expect(resultat.tiroir).toBe('2');
  });

  it('`rayon` absent du corps : jamais touché (patch partiel, pas écrasé à null)', async () => {
    const { tx, onConflictArgs } = txFactice({
      selects: [[{ id: 'a1' }], [{ id: 's1' }], [ligneStock({ stockMinimumMillieme: 5000 })]],
    });
    const service = new ServiceStock(accesFactice(tx));

    await service.modifierSite(CTX, 'a1', 's1', { stockMinimumMillieme: 5000 });

    const argument = onConflictArgs[0] as { set: Record<string, unknown> };
    expect('rayon' in argument.set).toBe(false);
    expect('tiroir' in argument.set).toBe(false);
  });

  it('un article sans rayon ni tiroir reste un état valide : `rayon`/`tiroir` explicitement `null`, jamais une erreur', async () => {
    const { tx } = txFactice({
      selects: [[{ id: 'a1' }], [{ id: 's1' }], [ligneStock({ rayon: null, tiroir: null })]],
    });
    const service = new ServiceStock(accesFactice(tx));

    const resultat = await service.modifierSite(CTX, 'a1', 's1', {});

    expect(resultat.rayon).toBeNull();
    expect(resultat.tiroir).toBeNull();
  });
});

describe('schemaModificationStockSite — normalisation du casier (0056), le seul point qui rend la structure utile', () => {
  it('« B3 », « b3 » et « B 3 » convergent tous vers la même valeur stockée', () => {
    const variantes = ['B3', 'b3', 'B 3', '  b3  ', 'b 3'];
    const normalisees = variantes.map(
      (rayon) => schemaModificationStockSite.parse({ rayon }).rayon,
    );

    for (const valeur of normalisees) {
      expect(valeur).toBe('B3');
    }
  });

  it('même normalisation pour `tiroir` (majuscule, aucun espace interne)', () => {
    expect(schemaModificationStockSite.parse({ tiroir: 't 2' }).tiroir).toBe('T2');
    expect(schemaModificationStockSite.parse({ tiroir: 'T2' }).tiroir).toBe('T2');
  });

  it('une entrée blanche (vide ou uniquement des espaces) devient `null`, jamais une chaîne vide stockée', () => {
    expect(schemaModificationStockSite.parse({ rayon: '' }).rayon).toBeNull();
    expect(schemaModificationStockSite.parse({ rayon: '   ' }).rayon).toBeNull();
  });

  it('`rayon` absent du corps reste `undefined` : un PATCH qui ne le mentionne pas ne le touche pas', () => {
    expect(schemaModificationStockSite.parse({}).rayon).toBeUndefined();
  });

  it('`rayon: null` explicite reste `null` : un PATCH peut effacer un casier déjà renseigné', () => {
    expect(schemaModificationStockSite.parse({ rayon: null }).rayon).toBeNull();
  });

  it('longueur bornée à 20 caractères (borne applicative, RP-11 étendu) : au-delà, rejeté', () => {
    expect(() => schemaModificationStockSite.parse({ rayon: 'X'.repeat(21) })).toThrow();
    expect(() => schemaModificationStockSite.parse({ rayon: 'X'.repeat(20) })).not.toThrow();
  });
});
