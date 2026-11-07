import { describe, expect, it, vi } from 'vitest';

import type { AccesBase, ContexteTenant } from '../db';

import { ServiceEtatDemarrage } from './service-etat-demarrage';

const ctx: ContexteTenant = { tenantId: 'tenant-1', utilisateurId: 'u1', requeteId: null };

function accesRendant(rows: unknown[]): { acces: AccesBase; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn().mockResolvedValue({ rows });
  const acces = {
    enTenant: (_ctx: ContexteTenant, travail: (tx: unknown) => Promise<unknown>) =>
      travail({ execute }),
  } as unknown as AccesBase;
  return { acces, execute };
}

describe('ServiceEtatDemarrage', () => {
  it('traduit chaque colonne en étape booléenne, en une seule requête', async () => {
    const { acces, execute } = accesRendant([
      {
        coordonnees: true,
        iban: false,
        numero_tva: true,
        taux_horaire: false,
        motifs_rdv: true,
        premier_collaborateur: false,
        borne: true,
      },
    ]);
    const etat = await new ServiceEtatDemarrage(acces).obtenir(ctx, 'u1');
    expect(etat).toEqual({
      etapes: {
        coordonnees: true,
        iban: false,
        numeroTva: true,
        tauxHoraire: false,
        motifsRdv: true,
        premierCollaborateur: false,
        borne: true,
      },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('une ligne absente donne « rien de réglé » (jamais une étape cochée par défaut)', async () => {
    const { acces } = accesRendant([]);
    const etat = await new ServiceEtatDemarrage(acces).obtenir(ctx, 'u1');
    expect(Object.values(etat.etapes).every((v) => v === false)).toBe(true);
  });
});
