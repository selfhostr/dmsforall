import { describe, expect, it, vi } from 'vitest';

import type { AccesBase, ContexteTenant } from '../../db';
import { ServiceParametresEntreprise } from './service-parametres-entreprise';

const CTX: ContexteTenant = { tenantId: 'tid', utilisateurId: null, requeteId: null };

interface LigneTenant {
  raisonSociale: string;
  numeroTva: string | null;
  delaiPaiementJoursDefaut?: number;
}

function acces(ligneBrute: LigneTenant | undefined) {
  const ligne = ligneBrute && { delaiPaiementJoursDefaut: 30, ...ligneBrute };
  const sets: unknown[] = [];
  const tx = {
    select: () => ({ from: () => ({ where: () => Promise.resolve(ligne ? [ligne] : []) }) }),
    update: () => ({
      set: (v: { numeroTva?: string | null; delaiPaiementJoursDefaut?: number }) => {
        sets.push(v);
        const definis = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
        return {
          where: () => ({
            returning: () => Promise.resolve(ligne ? [{ ...ligne, ...definis }] : []),
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
      delaiPaiementJoursDefaut: 30,
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

  it('modifie le délai de paiement par défaut sans toucher au n° TVA', async () => {
    const { base, sets } = acces({ raisonSociale: 'G', numeroTva: 'CHE-116.281.710 TVA' });
    const dto = await new ServiceParametresEntreprise(base).modifier(CTX, {
      delaiPaiementJoursDefaut: 10,
    });
    expect(sets).toEqual([{ delaiPaiementJoursDefaut: 10 }]);
    expect(dto).toEqual({
      raisonSociale: 'G',
      numeroTva: 'CHE-116.281.710 TVA',
      delaiPaiementJoursDefaut: 10,
    });
  });

  it('accepte un délai de 0 jour (comptant) : zéro n’est pas « absent »', async () => {
    const { base, sets } = acces({ raisonSociale: 'G', numeroTva: null });
    await new ServiceParametresEntreprise(base).modifier(CTX, { delaiPaiementJoursDefaut: 0 });
    expect(sets).toEqual([{ delaiPaiementJoursDefaut: 0 }]);
  });
});
