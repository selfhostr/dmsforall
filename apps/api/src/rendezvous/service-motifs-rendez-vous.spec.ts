import { describe, expect, it, vi } from 'vitest';

import type { AccesBase, ContexteTenant } from '../db';
import type { LigneMotifRendezVous } from '../db/schema';

import { ServiceMotifsRendezVous } from './service-motifs-rendez-vous';

const CTX: ContexteTenant = { tenantId: 'tid', utilisateurId: null, requeteId: null };

function ligne(champs: Partial<LigneMotifRendezVous> = {}): LigneMotifRendezVous {
  return {
    id: 'm1',
    tenantId: 'tid',
    code: 'SERVICE',
    libelleFr: 'Service',
    libelleDe: null,
    libelleIt: null,
    dureeDefautMinutes: 60,
    heuresAtelierDefautCentiemes: null,
    actif: true,
    creeLe: new Date(),
    modifieLe: new Date(),
    ...champs,
  };
}

function acces(options: {
  readonly retour?: LigneMotifRendezVous | undefined;
  readonly erreurInsert?: unknown;
}): AccesBase & { readonly valeurs: unknown[]; readonly sets: unknown[] } {
  const valeurs: unknown[] = [];
  const sets: unknown[] = [];
  const tx = {
    insert: () => ({
      values: (v: unknown) => {
        valeurs.push(v);
        return {
          returning: () =>
            options.erreurInsert
              ? Promise.reject(options.erreurInsert)
              : Promise.resolve(options.retour ? [options.retour] : []),
        };
      },
    }),
    update: () => ({
      set: (v: unknown) => {
        sets.push(v);
        return {
          where: () => ({
            returning: () => Promise.resolve(options.retour ? [options.retour] : []),
          }),
        };
      },
    }),
    select: () => ({
      from: () => ({ where: () => Promise.resolve(options.retour ? [options.retour] : []) }),
    }),
  };
  return {
    valeurs,
    sets,
    enTenant: vi.fn((_ctx, travail) => travail(tx as never)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
}

describe('ServiceMotifsRendezVous.creer', () => {
  it('crée avec le tenant du contexte, actif par défaut, champs absents à null', async () => {
    const a = acces({ retour: ligne({ code: 'FREINS' }) });
    const dto = await new ServiceMotifsRendezVous(a).creer(CTX, {
      code: 'FREINS',
      libelleFr: 'Freins',
    });
    expect(a.valeurs).toEqual([
      {
        tenantId: 'tid',
        code: 'FREINS',
        libelleFr: 'Freins',
        libelleDe: null,
        libelleIt: null,
        dureeDefautMinutes: null,
        heuresAtelierDefautCentiemes: null,
        actif: true,
      },
    ]);
    expect(dto.code).toBe('FREINS');
  });

  it('code déjà pris dans ce garage : CONFLIT', async () => {
    const a = acces({ erreurInsert: Object.assign(new Error('dup'), { code: '23505' }) });
    await expect(
      new ServiceMotifsRendezVous(a).creer(CTX, { code: 'SERVICE', libelleFr: 'x' }),
    ).rejects.toMatchObject({ code: 'CONFLIT' });
  });

  it('autre erreur base : remontée telle quelle', async () => {
    const a = acces({ erreurInsert: new Error('boom') });
    await expect(
      new ServiceMotifsRendezVous(a).creer(CTX, { code: 'X', libelleFr: 'x' }),
    ).rejects.toThrow('boom');
  });
});

describe('ServiceMotifsRendezVous.modifier', () => {
  it('désactive sans toucher au code', async () => {
    const a = acces({ retour: ligne({ actif: false }) });
    const dto = await new ServiceMotifsRendezVous(a).modifier(CTX, 'm1', { actif: false });
    expect(a.sets).toEqual([{ actif: false }]);
    expect(dto.actif).toBe(false);
  });

  it('null explicite efface une durée (≠ champ absent)', async () => {
    const a = acces({ retour: ligne({ dureeDefautMinutes: null }) });
    await new ServiceMotifsRendezVous(a).modifier(CTX, 'm1', { dureeDefautMinutes: null });
    expect(a.sets).toEqual([{ dureeDefautMinutes: null }]);
  });

  it('corps vide : relit sans UPDATE', async () => {
    const a = acces({ retour: ligne() });
    await new ServiceMotifsRendezVous(a).modifier(CTX, 'm1', {});
    expect(a.sets).toHaveLength(0);
  });

  it('motif inconnu de ce garage : RESSOURCE_INTROUVABLE', async () => {
    const a = acces({});
    await expect(
      new ServiceMotifsRendezVous(a).modifier(CTX, 'm1', { actif: false }),
    ).rejects.toMatchObject({ code: 'RESSOURCE_INTROUVABLE' });
  });
});
