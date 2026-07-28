import { describe, expect, it, vi } from 'vitest';
import type { AccesBase, ContexteTenant } from '../../../db';
import { schema } from '../../../db';
import { ServiceTauxHoraires } from './service-taux-horaires';

const CTX: ContexteTenant = { tenantId: 'tid', utilisateurId: null, requeteId: null };

function ligne(champs: Partial<schema.LigneTauxHoraire> = {}): schema.LigneTauxHoraire {
  return {
    id: 'th-1',
    tenantId: 'tid',
    code: 'MEC',
    libelle: 'Mécanique générale',
    montantCentimes: 14500,
    valideDu: '2026-01-01',
    valideAu: null,
    creeLe: new Date('2026-01-01T00:00:00.000Z'),
    modifieLe: new Date('2026-01-01T00:00:00.000Z'),
    ...champs,
  } as schema.LigneTauxHoraire;
}

interface OptionsAcces {
  readonly lignesListe?: readonly schema.LigneTauxHoraire[];
  readonly ligneInsert?: schema.LigneTauxHoraire | undefined;
  readonly erreurInsert?: unknown;
  readonly ligneUpdate?: schema.LigneTauxHoraire | undefined;
  readonly ligneSelectUnitaire?: schema.LigneTauxHoraire | undefined;
  readonly erreurUpdate?: unknown;
}

function accesFactice(options: OptionsAcces): AccesBase {
  const tx = {
    select: () => ({
      from: () => ({
        where: () => {
          if (options.lignesListe) {
            return { orderBy: () => ({ limit: () => Promise.resolve(options.lignesListe) }) };
          }
          return Promise.resolve(options.ligneSelectUnitaire ? [options.ligneSelectUnitaire] : []);
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        returning: () => {
          if (options.erreurInsert) return Promise.reject(options.erreurInsert);
          return Promise.resolve(options.ligneInsert ? [options.ligneInsert] : []);
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => {
            if (options.erreurUpdate) return Promise.reject(options.erreurUpdate);
            return Promise.resolve(options.ligneUpdate ? [options.ligneUpdate] : []);
          },
        }),
      }),
    }),
  };
  return {
    enTenant: vi.fn((_ctx, travail) => travail(tx as never)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
}

describe('ServiceTauxHoraires.lister', () => {
  it('projette les lignes et pagine', async () => {
    const service = new ServiceTauxHoraires(accesFactice({ lignesListe: [ligne()] }));
    const page = await service.lister(CTX, 50, undefined);
    expect(page.donnees).toHaveLength(1);
    expect(page.donnees[0]?.code).toBe('MEC');
    expect(page.limite).toBe(50);
  });
});

describe('ServiceTauxHoraires.creer', () => {
  it('crée et projette la ligne', async () => {
    const service = new ServiceTauxHoraires(accesFactice({ ligneInsert: ligne() }));
    const dto = await service.creer(CTX, {
      code: 'MEC',
      libelle: 'Mécanique générale',
      montantCentimes: 14500,
      valideDuLe: '2026-01-01',
    });
    expect(dto.code).toBe('MEC');
    expect(dto.montantCentimes).toBe(14500);
  });

  it('période chevauchante (exclusion_violation, 23P01) : 409 CONFLIT', async () => {
    const service = new ServiceTauxHoraires(
      accesFactice({ erreurInsert: { code: '23P01', message: 'exclusion violation' } }),
    );
    await expect(
      service.creer(CTX, { code: 'MEC', libelle: 'X', montantCentimes: 1000, valideDuLe: '2026-01-01' }),
    ).rejects.toMatchObject({ code: 'CONFLIT' });
  });

  it('autre erreur base : propagée telle quelle, jamais masquée en CONFLIT', async () => {
    const erreur = new Error('panne réseau');
    const service = new ServiceTauxHoraires(accesFactice({ erreurInsert: erreur }));
    await expect(
      service.creer(CTX, { code: 'MEC', libelle: 'X', montantCentimes: 1000, valideDuLe: '2026-01-01' }),
    ).rejects.toThrow('panne réseau');
  });
});

describe('ServiceTauxHoraires.modifier', () => {
  it('met à jour et projette la ligne', async () => {
    const service = new ServiceTauxHoraires(accesFactice({ ligneUpdate: ligne({ libelle: 'Renommé' }) }));
    const dto = await service.modifier(CTX, 'th-1', { libelle: 'Renommé' });
    expect(dto.libelle).toBe('Renommé');
  });

  it('corps vide : relit sans écrire', async () => {
    const service = new ServiceTauxHoraires(accesFactice({ ligneSelectUnitaire: ligne() }));
    const dto = await service.modifier(CTX, 'th-1', {});
    expect(dto.code).toBe('MEC');
  });

  it('id introuvable pour ce tenant : RESSOURCE_INTROUVABLE', async () => {
    const service = new ServiceTauxHoraires(accesFactice({ ligneUpdate: undefined }));
    await expect(service.modifier(CTX, 'absent', { libelle: 'X' })).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
    });
  });

  it('extension de période en collision (23P01) : 409 CONFLIT', async () => {
    const service = new ServiceTauxHoraires(
      accesFactice({ erreurUpdate: { code: '23P01', message: 'exclusion violation' } }),
    );
    await expect(service.modifier(CTX, 'th-1', { valideAuLe: null })).rejects.toMatchObject({ code: 'CONFLIT' });
  });
});
