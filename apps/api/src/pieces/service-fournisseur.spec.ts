import { describe, expect, it, vi } from 'vitest';
import type { EntreeCreationFournisseur } from '@dfa/shared';

import type { AccesBase, ContexteTenant, TransactionDfa } from '../db';
import type { LigneFournisseur } from '../db/schema';
import { ServiceFournisseur } from './service-fournisseur';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };

function ligneFournisseur(champs: Partial<LigneFournisseur> = {}): LigneFournisseur {
  return {
    id: 'f1',
    tenantId: 'tid-1',
    nom: 'Bosch Suisse SA',
    email: null,
    telephone: null,
    delaiHabituelJours: 3,
    statut: 'actif',
    creeLe: new Date('2026-07-31T08:00:00.000Z'),
    modifieLe: new Date('2026-07-31T08:00:00.000Z'),
    ...champs,
  } as LigneFournisseur;
}

function txFactice(plan: { selects?: readonly unknown[][] } = {}) {
  const selects = [...(plan.selects ?? [])];
  const setArgs: unknown[] = [];
  const insertValuesArgs: Array<Record<string, unknown>> = [];

  function chaineWhere() {
    const valeur = Promise.resolve(selects.shift() ?? []);
    return { limit: () => valeur, then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => valeur.then(resolve, reject) };
  }

  const tx = {
    select: () => ({ from: () => ({ where: () => chaineWhere() }) }),
    update: () => ({ set: (vals: unknown) => { setArgs.push(vals); return { where: () => Promise.resolve(undefined) }; } }),
    insert: (_table: unknown) => ({
      values: (vals: Record<string, unknown>) => {
        insertValuesArgs.push(vals);
        return { returning: () => Promise.resolve([ligneFournisseur(vals)]) };
      },
    }),
  };

  return { tx: tx as unknown as TransactionDfa, setArgs, insertValuesArgs };
}

function accesFactice(tx: TransactionDfa): AccesBase {
  return { enTenant: vi.fn((_ctx, travail) => travail(tx)), verifierConnexion: vi.fn(), verifierPostureRls: vi.fn() };
}

describe('ServiceFournisseur — RP-26/§1 : référentiel minimal, pas de suppression', () => {
  it('parId : 404 RESSOURCE_INTROUVABLE quand le fournisseur n’existe pas pour ce tenant', async () => {
    const { tx } = txFactice({ selects: [[]] });
    const service = new ServiceFournisseur(accesFactice(tx));

    await expect(service.parId(CTX, 'inconnu')).rejects.toMatchObject({ code: 'RESSOURCE_INTROUVABLE', status: 404 });
  });

  it('creer : pas d’Idempotency-Key nécessaire, insère et enveloppe d’avertissements (vide)', async () => {
    const { tx, insertValuesArgs } = txFactice();
    const service = new ServiceFournisseur(accesFactice(tx));
    const entree: EntreeCreationFournisseur = { nom: 'Bosch Suisse SA', delaiHabituelJours: 3 };

    const resultat = await service.creer(CTX, entree);

    expect(resultat.donnees.nom).toBe('Bosch Suisse SA');
    expect(resultat.avertissements).toHaveLength(0);
    expect(insertValuesArgs[0]).toMatchObject({ tenantId: 'tid-1', nom: 'Bosch Suisse SA', delaiHabituelJours: 3 });
  });

  it('desactiver : bascule statut à inactif (RP-07/RM-12/RM-31 — jamais de suppression)', async () => {
    const { tx, setArgs } = txFactice({ selects: [[ligneFournisseur()], [ligneFournisseur({ statut: 'inactif' })]] });
    const service = new ServiceFournisseur(accesFactice(tx));

    const resultat = await service.desactiver(CTX, 'f1');

    expect(resultat.donnees.statut).toBe('inactif');
    expect(setArgs[0]).toMatchObject({ statut: 'inactif' });
  });

  it('modifier : n’écrit rien si le corps est vide ({}), relit simplement la fiche', async () => {
    const { tx, setArgs } = txFactice({ selects: [[ligneFournisseur()], [ligneFournisseur()]] });
    const service = new ServiceFournisseur(accesFactice(tx));

    await service.modifier(CTX, 'f1', {});

    expect(setArgs).toHaveLength(0);
  });
});
