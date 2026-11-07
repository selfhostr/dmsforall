import { describe, expect, it, vi } from 'vitest';

import type { AccesBase, ContexteTenant } from '../../db';
import { ServiceParametresEntreprise } from './service-parametres-entreprise';

const CTX: ContexteTenant = { tenantId: 'tid', utilisateurId: null, requeteId: null };

function acces(ligne: { raisonSociale: string; numeroTva: string | null } | undefined) {
  const sets: unknown[] = [];
  const tx = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(ligne ? [ligne] : []) }) }),
    update: () => ({
      set: (v: { numeroTva: string | null }) => {
        sets.push(v);
        return {
          where: () => ({
            returning: () => Promise.resolve(ligne ? [{ ...ligne, numeroTva: v.numeroTva }] : []),
          }),
        };
      },
    }),
  };
  const base: AccesBase = {
    enTenant: vi.fn((_c, travail) => travail(tx as never)),
    verifierConnexion: vi.fn(),
    verifierPostureRls: vi.fn(),
  };
  return { base, sets };
}

describe('ServiceParametresEntreprise', () => {
  it('lit la raison sociale et le n° TVA (null tant que non saisi)', async () => {
    const { base } = acces({ raisonSociale: 'Garage Sandra', numeroTva: null });
    expect(await new ServiceParametresEntreprise(base).obtenir(CTX)).toEqual({
      raisonSociale: 'Garage Sandra',
      numeroTva: null,
    });
  });

  it('saisit le n° TVA', async () => {
    const { base, sets } = acces({ raisonSociale: 'G', numeroTva: null });
    const dto = await new ServiceParametresEntreprise(base).modifier(CTX, {
      numeroTva: 'CHE-116.281.710 TVA',
    });
    expect(sets).toEqual([{ numeroTva: 'CHE-116.281.710 TVA' }]);
    expect(dto.numeroTva).toBe('CHE-116.281.710 TVA');
  });

  it('null efface le numéro', async () => {
    const { base, sets } = acces({ raisonSociale: 'G', numeroTva: 'CHE-116.281.710 TVA' });
    const dto = await new ServiceParametresEntreprise(base).modifier(CTX, { numeroTva: null });
    expect(sets).toEqual([{ numeroTva: null }]);
    expect(dto.numeroTva).toBeNull();
  });

  it('corps vide : aucune écriture', async () => {
    const { base, sets } = acces({ raisonSociale: 'G', numeroTva: 'CHE-116.281.710 TVA' });
    const dto = await new ServiceParametresEntreprise(base).modifier(CTX, {});
    expect(sets).toHaveLength(0);
    expect(dto.numeroTva).toBe('CHE-116.281.710 TVA');
  });

  it('tenant introuvable : RESSOURCE_INTROUVABLE', async () => {
    const { base } = acces(undefined);
    await expect(new ServiceParametresEntreprise(base).obtenir(CTX)).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
    });
  });
});
