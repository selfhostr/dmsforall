import { describe, expect, it, vi } from 'vitest';
import type { EntreeModificationParametresPieces } from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import type { LigneParametrePieces } from '../db/schema';
import { ServiceParametragePieces } from './service-parametrage-pieces';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };

function ligneParametres(champs: Partial<LigneParametrePieces> = {}): LigneParametrePieces {
  return {
    tenantId: 'tid-1',
    stockAutresSitesVisible: true,
    stockNegatifForcageAutorise: false,
    methodePrixAchat: null,
    seuilValeurAjustementSignificatifCentimes: null,
    delaiConsigneAcquisitionJours: null,
    tauxTvaConsignePourmille: 81,
    creeLe: new Date('2026-07-31T08:00:00.000Z'),
    modifieLe: new Date('2026-07-31T08:00:00.000Z'),
    ...champs,
  } as LigneParametrePieces;
}

/**
 * `garantirLigne` fait `insert(...).onConflictDoNothing()` PUIS relit — le mock n'a pas besoin de
 * distinguer les deux : `onConflictDoNothing()` est chaîné sur le retour de `.values()`, qui doit
 * donc être awaitable directement (aucun `.returning()` dans ce service).
 */
function txFactice(selects: readonly unknown[][]) {
  const file = [...selects];
  const setArgs: unknown[] = [];
  const insertValuesArgs: unknown[] = [];

  const tx = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(file.shift() ?? []) }) }),
    insert: (_table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        insertValuesArgs.push(vals);
        return { onConflictDoNothing: () => Promise.resolve(undefined) };
      },
    }),
    update: () => ({
      set: (vals: unknown) => {
        setArgs.push(vals);
        return { where: () => ({ returning: () => Promise.resolve([ligneParametres(vals as Partial<LigneParametrePieces>)]) }) };
      },
    }),
  };

  return { tx: tx as unknown as TransactionDfa, setArgs, insertValuesArgs };
}

function accesFactice(tx: TransactionDfa): AccesBase {
  return { enTenant: vi.fn((_ctx, travail) => travail(tx)), verifierConnexion: vi.fn(), verifierPostureRls: vi.fn() };
}

describe('ServiceParametragePieces — §10 : résilient à l’absence de ligne de bootstrap (voir en-tête du service)', () => {
  it('obtenir : tente TOUJOURS `insert … on conflict do nothing` (idempotent que la ligne existe déjà ou non) puis lit la ligne', async () => {
    const { tx, insertValuesArgs } = txFactice([[ligneParametres()]]);
    const service = new ServiceParametragePieces(accesFactice(tx));

    const resultat = await service.obtenir(CTX);

    expect(insertValuesArgs).toHaveLength(1);
    expect(insertValuesArgs[0]).toMatchObject({ tenantId: 'tid-1' });
    expect(resultat.stockAutresSitesVisible).toBe(true);
    expect(resultat.methodePrixAchat).toBeNull();
    expect(resultat.conditionnementArticleDistinct).toBe(true);
  });

  it('modifier : corps vide ({}) → n’écrit rien (aucun UPDATE), relit l’état courant', async () => {
    // 1er select : chargerLigne() interne à garantirLigne(). 2e select : le rechargement explicite
    // de branche « corps vide » (aucun UPDATE entre les deux, la ligne ne change pas).
    const { tx, setArgs } = txFactice([[ligneParametres()], [ligneParametres()]]);
    const service = new ServiceParametragePieces(accesFactice(tx));

    await service.modifier(CTX, {});

    expect(setArgs).toHaveLength(0);
  });

  it('modifier : seuls les champs présents sont écrits, `methodePrixAchat: null` explicite reste distinct de « absent »', async () => {
    // Un seul select (garantirLigne), puis directement l'UPDATE — pas de second SELECT puisque
    // `valeurs` n'est pas vide.
    const { tx, setArgs } = txFactice([[ligneParametres()]]);
    const service = new ServiceParametragePieces(accesFactice(tx));
    const entree: EntreeModificationParametresPieces = { tauxTvaConsignePourmille: 26 };

    const resultat = await service.modifier(CTX, entree);

    expect(setArgs[0]).toEqual({ tauxTvaConsignePourmille: 26 });
    expect(resultat.tauxTvaConsignePourmille).toBe(26);
  });
});
