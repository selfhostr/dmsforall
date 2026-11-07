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

const CREANCIER_COMPLET = {
  nom: 'Garage Martin SA',
  rue: 'Route de Riddes',
  numero: '42',
  npa: '1950',
  localite: 'Sion',
  pays: 'CH',
};

describe('ServiceEtatDemarrage', () => {
  it('traduit chaque colonne en étape booléenne, en une seule requête', async () => {
    const { acces, execute } = accesRendant([
      {
        creancier: CREANCIER_COMPLET,
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

  describe('étape coordonnées — mêmes champs requis que l’émission (A2)', () => {
    async function coordonnees(creancier: unknown): Promise<boolean> {
      const { acces } = accesRendant([{ creancier, numero_tva: false }]);
      return (await new ServiceEtatDemarrage(acces).obtenir(ctx, 'u1')).etapes.coordonnees;
    }

    it('adresse complète : fait', async () => {
      expect(await coordonnees(CREANCIER_COMPLET)).toBe(true);
    });

    it('sans n° de rue : PAS fait (l’émission le refuserait avec QR_CREANCIER_INCOMPLET)', async () => {
      expect(await coordonnees({ ...CREANCIER_COMPLET, numero: null })).toBe(false);
      expect(await coordonnees({ ...CREANCIER_COMPLET, numero: '   ' })).toBe(false);
    });

    it.each(['nom', 'rue', 'npa', 'localite'] as const)('sans %s : pas fait', async (champ) => {
      expect(await coordonnees({ ...CREANCIER_COMPLET, [champ]: null })).toBe(false);
    });

    it('sans pays : fait (le pays vaut CH par défaut, comme à l’émission)', async () => {
      expect(await coordonnees({ ...CREANCIER_COMPLET, pays: null })).toBe(true);
    });

    it('aucun bloc créancier : pas fait', async () => {
      expect(await coordonnees(null)).toBe(false);
    });
  });

  it('étape TVA : la colonne SQL tient compte de l’assujettissement', async () => {
    const { acces, execute } = accesRendant([{ creancier: null, numero_tva: true }]);
    const etat = await new ServiceEtatDemarrage(acces).obtenir(ctx, 'u1');
    expect(etat.etapes.numeroTva).toBe(true);
    const texte = JSON.stringify(execute.mock.calls[0]?.[0]);
    expect(texte).toContain('assujetti_tva');
  });
});
