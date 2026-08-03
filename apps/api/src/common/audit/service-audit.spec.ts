import { describe, expect, it, vi } from 'vitest';
import type { AccesBase, ContexteTenant, TransactionDfa } from '../../db';
import { ServiceAuditImpl } from './service-audit';

const CTX: ContexteTenant = {
  tenantId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  utilisateurId: null,
  requeteId: null,
};

function accesFactice(tx: { execute: ReturnType<typeof vi.fn> }): AccesBase {
  return {
    enTenant: async (_ctx, travail) => travail(tx as unknown as TransactionDfa),
    verifierConnexion: async () => undefined,
    verifierPostureRls: async () => undefined,
  };
}

describe('ServiceAuditImpl.pourEntite', () => {
  it('projette les colonnes snake_case brutes vers EntreeAudit (camelCase)', async () => {
    const creeLe = new Date('2026-07-28T09:00:00.000Z');
    const execute = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'audit-1',
          entite: 'ordre_reparation',
          entite_id: 'or-1',
          action: 'transition',
          champ: null,
          valeur_avant: { statut: 'ouvert' },
          valeur_apres: { statut: 'en_cours' },
          utilisateur_id: 'u-1',
          requete_id: 'req-1',
          cree_le: creeLe,
        },
      ],
    });
    const service = new ServiceAuditImpl(accesFactice({ execute }));

    const entrees = await service.pourEntite(CTX, 'ordre_reparation', 'or-1');

    expect(entrees).toEqual([
      {
        id: 'audit-1',
        entite: 'ordre_reparation',
        entiteId: 'or-1',
        action: 'transition',
        champ: null,
        valeurAvant: { statut: 'ouvert' },
        valeurApres: { statut: 'en_cours' },
        utilisateurId: 'u-1',
        requeteId: 'req-1',
        creeLe,
      },
    ]);
  });

  it('rend un tableau vide quand aucune ligne ne correspond, sans lever', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const service = new ServiceAuditImpl(accesFactice({ execute }));

    await expect(service.pourEntite(CTX, 'ligne_or', 'inconnue')).resolves.toEqual([]);
  });

  it('interroge la base via enTenant (contexte tenant posé), pas un accès direct', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const acces = accesFactice({ execute });
    const enTenantEspion = vi.spyOn(acces, 'enTenant');
    const service = new ServiceAuditImpl(acces);

    await service.pourEntite(CTX, 'ordre_reparation', 'or-1');

    expect(enTenantEspion).toHaveBeenCalledWith(CTX, expect.any(Function));
  });
});
