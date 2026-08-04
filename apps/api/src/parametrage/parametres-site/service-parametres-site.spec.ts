import { describe, expect, it, vi } from 'vitest';
import type { AccesBase, ContexteTenant } from '../../db';
import { schema } from '../../db';
import { ServiceParametresSite } from './service-parametres-site';

const CTX: ContexteTenant = { tenantId: 'tid', utilisateurId: null, requeteId: null };
const SITE_ID = 'site-1';

function ligneBrute(champs: Partial<schema.LigneParametreSite> = {}): schema.LigneParametreSite {
  return {
    tenantId: 'tid',
    siteId: SITE_ID,
    heureOuverture: '08:00:00',
    heureFermeture: '18:00:00',
    heureCloturePointage: null,
    capaciteHeuresJourCentiemes: null,
    joursFermeture: [],
    creeLe: new Date('2026-01-01T00:00:00.000Z'),
    modifieLe: new Date('2026-07-27T09:14:22.000Z'),
    ...champs,
  } as schema.LigneParametreSite;
}

function accesFactice(options: {
  readonly ligneSelect?: schema.LigneParametreSite | undefined;
  readonly ligneUpdate?: schema.LigneParametreSite | undefined;
}): AccesBase {
  const tx = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(options.ligneSelect ? [options.ligneSelect] : []),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(options.ligneUpdate ? [options.ligneUpdate] : []),
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

describe('ServiceParametresSite.obtenir', () => {
  it('projette la ligne et tronque les heures à HH:MM', async () => {
    const service = new ServiceParametresSite(accesFactice({ ligneSelect: ligneBrute() }));
    const dto = await service.obtenir(CTX, SITE_ID);
    expect(dto.heureOuverture).toBe('08:00');
    expect(dto.heureFermeture).toBe('18:00');
  });

  it('capacite non saisie : null, jamais 0 (§8.5, honnêteté de la barre de charge)', async () => {
    const service = new ServiceParametresSite(
      accesFactice({ ligneSelect: ligneBrute({ capaciteHeuresJourCentiemes: null }) }),
    );
    const dto = await service.obtenir(CTX, SITE_ID);
    expect(dto.capaciteHeuresJourCentiemes).toBeNull();
  });

  it('site sans ligne de paramétrage : RESSOURCE_INTROUVABLE', async () => {
    const service = new ServiceParametresSite(accesFactice({ ligneSelect: undefined }));
    await expect(service.obtenir(CTX, SITE_ID)).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
    });
  });
});

describe('ServiceParametresSite.modifier', () => {
  it('écrit les colonnes fournies et rend la ligne mise à jour', async () => {
    const service = new ServiceParametresSite(
      accesFactice({ ligneUpdate: ligneBrute({ capaciteHeuresJourCentiemes: 80000 }) }),
    );
    const dto = await service.modifier(CTX, SITE_ID, { capaciteHeuresJourCentiemes: 80000 });
    expect(dto.capaciteHeuresJourCentiemes).toBe(80000);
  });

  it('corps vide : relit sans UPDATE sans SET', async () => {
    const service = new ServiceParametresSite(accesFactice({ ligneSelect: ligneBrute() }));
    const dto = await service.modifier(CTX, SITE_ID, {});
    expect(dto.siteId).toBe(SITE_ID);
  });
});
