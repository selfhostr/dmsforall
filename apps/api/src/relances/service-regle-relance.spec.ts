import { describe, expect, it, vi } from 'vitest';
import type { EntreeUpsertRegleRelance } from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import type { LigneRegleRelance } from '../db/schema';
import { ServiceRegleRelance } from './service-regle-relance';

function ligneRegle(champs: Partial<LigneRegleRelance> = {}): LigneRegleRelance {
  return {
    id: 'regle-1',
    tenantId: 'tid-1',
    typeRelance: 'facture_echue',
    actif: true,
    delaisJours: [7, 15],
    canaux: ['email'],
    texteModeleId: null,
    prereglageAppliqueLe: null,
    creeLe: new Date('2026-08-01T08:00:00.000Z'),
    modifieLe: new Date('2026-08-01T08:00:00.000Z'),
    ...champs,
  } as LigneRegleRelance;
}

/** Même patron que `pieces/service-parametrage-pieces.spec.ts` : un `tx` factice qui rend des
 *  valeurs pré-programmées, aveugle au contenu exact des clauses `where`. */
function txFactice(selects: readonly unknown[][], upsertResultat?: LigneRegleRelance) {
  const file = [...selects];
  const insertValuesArgs: unknown[] = [];
  const onConflictTargets: unknown[] = [];

  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => Promise.resolve(file.shift() ?? []) }),
      }),
    }),
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        insertValuesArgs.push(vals);
        return {
          onConflictDoUpdate: (options: { target: unknown; set: unknown }) => {
            onConflictTargets.push(options.target);
            return { returning: () => Promise.resolve(upsertResultat ? [upsertResultat] : []) };
          },
        };
      },
    }),
  };

  return { tx: tx as unknown as TransactionDfa, insertValuesArgs, onConflictTargets };
}

function accesFactice(tx: TransactionDfa): { acces: AccesBase; ctxRecu: ContexteTenant[] } {
  const ctxRecu: ContexteTenant[] = [];
  const acces: AccesBase = {
    enTenant: vi.fn((ctx, travail) => {
      ctxRecu.push(ctx);
      return travail(tx);
    }),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
  return { acces, ctxRecu };
}

const CTX_A: ContexteTenant = { tenantId: 'tenant-A', utilisateurId: 'u1', requeteId: null };
const CTX_B: ContexteTenant = { tenantId: 'tenant-B', utilisateurId: 'u2', requeteId: null };

describe('ServiceRegleRelance — droits provisoires (voir droits-provisoires.ts)', () => {
  it('lister : refuse un rôle non autorisé AVANT tout accès base (aucun DB touché)', async () => {
    const { tx } = txFactice([[ligneRegle()]]);
    const { acces } = accesFactice(tx);
    const service = new ServiceRegleRelance(acces);

    await expect(service.lister(CTX_A, 'technicien')).rejects.toMatchObject({
      code: 'DROIT_INSUFFISANT',
    });
    expect(acces.enTenant).not.toHaveBeenCalled();
  });

  it('upserter : refuse un rôle non autorisé AVANT tout accès base', async () => {
    const { tx } = txFactice([]);
    const { acces } = accesFactice(tx);
    const service = new ServiceRegleRelance(acces);
    const entree: EntreeUpsertRegleRelance = { actif: true, delaisJours: [7], canaux: ['email'] };

    await expect(service.upserter(CTX_A, 'vendeur', 'facture_echue', entree)).rejects.toMatchObject(
      {
        code: 'DROIT_INSUFFISANT',
      },
    );
    expect(acces.enTenant).not.toHaveBeenCalled();
  });

  it.each(['direction', 'comptable'] as const)('%s est autorisé', async (role) => {
    const { tx } = txFactice([[ligneRegle()]]);
    const { acces } = accesFactice(tx);
    const service = new ServiceRegleRelance(acces);

    await expect(service.lister(CTX_A, role)).resolves.toHaveLength(1);
  });
});

describe('ServiceRegleRelance — isolation tenant', () => {
  it(
    'lister : transmet EXACTEMENT le ctx (tenantId) de l’appelant à AccesBase.enTenant, ' +
      'jamais un autre — deux tenants différents ne se mélangent jamais côté application ' +
      '(le RLS posé en migration est le filet, pas le seul mécanisme)',
    async () => {
      const { tx } = txFactice([[ligneRegle({ tenantId: 'tenant-A' })]]);
      const { acces, ctxRecu } = accesFactice(tx);
      const service = new ServiceRegleRelance(acces);

      await service.lister(CTX_A, 'direction');
      expect(ctxRecu).toEqual([CTX_A]);

      const { tx: tx2 } = txFactice([[ligneRegle({ tenantId: 'tenant-B' })]]);
      const { acces: acces2, ctxRecu: ctxRecu2 } = accesFactice(tx2);
      const service2 = new ServiceRegleRelance(acces2);
      await service2.lister(CTX_B, 'direction');
      expect(ctxRecu2).toEqual([CTX_B]);
      expect(ctxRecu2).not.toEqual(ctxRecu);
    },
  );
});

describe('ServiceRegleRelance — mapping et upsert (§5)', () => {
  it('lister : delaisJours/canaux null en base (colonnes non renseignées) deviennent [] côté API', async () => {
    const { tx } = txFactice([
      [ligneRegle({ delaisJours: null as unknown as number[], canaux: null as unknown as [] })],
    ]);
    const { acces } = accesFactice(tx);
    const service = new ServiceRegleRelance(acces);

    const resultat = await service.lister(CTX_A, 'direction');
    expect(resultat).toHaveLength(1);
    expect(resultat[0]?.delaisJours).toEqual([]);
    expect(resultat[0]?.canaux).toEqual([]);
  });

  it(
    'upserter : cible la contrainte unique (tenant, type) — l’upsert ne peut jamais créer un ' +
      'doublon de configuration pour le même type',
    async () => {
      const resultat = ligneRegle({
        actif: false,
        delaisJours: [10, 30],
        canaux: ['sms', 'email'],
      });
      const { tx, insertValuesArgs, onConflictTargets } = txFactice([], resultat);
      const { acces } = accesFactice(tx);
      const service = new ServiceRegleRelance(acces);
      const entree: EntreeUpsertRegleRelance = {
        actif: false,
        delaisJours: [10, 30],
        canaux: ['sms', 'email'],
      };

      const reponse = await service.upserter(CTX_A, 'comptable', 'facture_echue', entree);

      expect(insertValuesArgs[0]).toMatchObject({
        tenantId: 'tenant-A',
        typeRelance: 'facture_echue',
        actif: false,
        delaisJours: [10, 30],
        canaux: ['sms', 'email'],
      });
      expect(onConflictTargets).toHaveLength(1);
      expect(reponse.actif).toBe(false);
      expect(reponse.delaisJours).toEqual([10, 30]);
    },
  );
});
