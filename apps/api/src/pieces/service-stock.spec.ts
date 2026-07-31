import { describe, expect, it, vi } from 'vitest';
import { SEUIL_RESERVATIONS_DISPONIBILITE } from '@dfa/shared';

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

function txFactice(plan: { selects?: readonly unknown[][]; executes?: ReadonlyArray<{ rows: readonly unknown[] }> } = {}) {
  const selects = [...(plan.selects ?? [])];
  const executes = [...(plan.executes ?? [])];
  const onConflictArgs: unknown[] = [];

  const tx = {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(selects.shift() ?? []) }) }) }),
    insert: (_table: unknown) => ({
      values: (_vals: unknown) => ({
        onConflictDoUpdate: (args: unknown) => {
          onConflictArgs.push(args);
          return Promise.resolve(undefined);
        },
      }),
    }),
    execute: vi.fn(() => Promise.resolve(executes.shift() ?? { rows: [] })),
  };

  return { tx: tx as unknown as TransactionDfa, onConflictArgs };
}

function accesFactice(tx: TransactionDfa): AccesBase {
  return { enTenant: vi.fn((_ctx, travail) => travail(tx)), verifierConnexion: vi.fn(), verifierPostureRls: vi.fn() };
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
    const lignesEnTrop = Array.from({ length: SEUIL_RESERVATIONS_DISPONIBILITE + 1 }, (_, i) => reservationActive(i));
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
      selects: [[{ id: 'a1' }], [{ id: 's1' }], [ligneStock({ emplacement: 'C4', quantitePhysiqueMillieme: 0, quantiteReserveeMillieme: 0 })]],
    });
    const service = new ServiceStock(accesFactice(tx));

    const resultat = await service.modifierSite(CTX, 'a1', 's1', { emplacement: 'C4' });

    expect(onConflictArgs).toHaveLength(1);
    expect(resultat.emplacement).toBe('C4');
    expect(resultat.quantitePhysiqueMillieme).toBe(0);
  });
});
