import { describe, expect, it, vi } from 'vitest';

import type { AccesBase, ContexteTenant } from '../../db';
import { ServiceModules } from './service-modules';

const CTX: ContexteTenant = { tenantId: 'tid', utilisateurId: 'uid', requeteId: 'req' };

function acces(desactives: string[] | undefined) {
  const sets: unknown[] = [];
  const audits: unknown[] = [];
  const tx = {
    select: () => ({
      from: () => ({ where: () => Promise.resolve(desactives ? [{ d: desactives }] : []) }),
    }),
    update: () => ({
      set: (v: unknown) => {
        sets.push(v);
        return { where: () => Promise.resolve() };
      },
    }),
    insert: () => ({
      values: (v: unknown) => {
        audits.push(v);
        return Promise.resolve();
      },
    }),
  };
  const base: AccesBase = {
    enTenant: vi.fn((_c, travail) => travail(tx as never)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
  return { base, sets, audits };
}

describe('ServiceModules', () => {
  it('obtenir : choix du garage + modules effectivement actifs (dépendances)', async () => {
    const { base } = acces(['atelier']);
    const r = await new ServiceModules(base).obtenir(CTX);
    expect(r.modulesDesactives).toEqual(['atelier']);
    expect(r.modulesActifs).not.toContain('atelier');
    expect(r.modulesActifs).not.toContain('pointage');
    expect(r.modulesActifs).not.toContain('tablettes');
    expect(r.modulesActifs).toContain('planning');
  });

  it('modifier : écrit la liste normalisée (sans doublon, ordre du contrat) et journalise avant/après', async () => {
    const { base, sets, audits } = acces([]);
    const r = await new ServiceModules(base).modifier(CTX, {
      modulesDesactives: ['ventes', 'pneus', 'ventes'],
    });
    expect(sets).toEqual([{ modulesDesactives: ['ventes', 'pneus'] }]);
    expect(r.modulesDesactives).toEqual(['ventes', 'pneus']);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      tenantId: 'tid',
      entite: 'tenant',
      champ: 'modules_desactives',
      valeurAvant: [],
      valeurApres: ['ventes', 'pneus'],
      utilisateurId: 'uid',
    });
  });

  it('modifier : liste identique -> aucune écriture, aucun audit', async () => {
    const { base, sets, audits } = acces(['pneus']);
    await new ServiceModules(base).modifier(CTX, { modulesDesactives: ['pneus'] });
    expect(sets).toEqual([]);
    expect(audits).toEqual([]);
  });

  it('réactiver tout : liste vide, tout redevient actif', async () => {
    const { base } = acces(['pneus', 'atelier']);
    const r = await new ServiceModules(base).modifier(CTX, { modulesDesactives: [] });
    expect(r.modulesDesactives).toEqual([]);
    expect(r.modulesActifs).toHaveLength(10);
  });

  it('garage introuvable : RESSOURCE_INTROUVABLE', async () => {
    const { base } = acces(undefined);
    await expect(new ServiceModules(base).obtenir(CTX)).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
    });
  });
});
