import { describe, expect, it, vi } from 'vitest';
import type { ContexteTenant, TransactionDfa } from '../../db';
import type { Horloge } from '../horloge/horloge';
import { ServiceEvenementsImpl } from './service-evenements';

const CTX: ContexteTenant = { tenantId: '3fa85f64-5717-4562-b3fc-2c963f66afa6', utilisateurId: 'u-1', requeteId: 'r-1' };

function horlogeFigee(): Horloge {
  return { maintenant: () => new Date('2026-07-28T10:00:00.000Z') } as Horloge;
}

describe('ServiceEvenementsImpl.publier', () => {
  it('écrit une seule ligne, via le tx REÇU (pas une transaction ouverte par lui-même)', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const tx = { execute } as unknown as TransactionDfa;
    const service = new ServiceEvenementsImpl(horlogeFigee());

    await service.publier(tx, CTX, {
      type: 'ordre_reparation.ouvert',
      versionSchema: 1,
      siteId: 's-1',
      ressource: { type: 'ordre_reparation', id: 'or-1', numero: 'OR-2026-001' },
      donnees: { statut: 'ouvert' },
    });

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('ne lève pas quand ressource.numero est absent (optionnel)', async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    const tx = { execute } as unknown as TransactionDfa;
    const service = new ServiceEvenementsImpl(horlogeFigee());

    await expect(
      service.publier(tx, CTX, {
        type: 'vehicule.kilometrage_releve',
        versionSchema: 1,
        siteId: null,
        ressource: { type: 'vehicule', id: 'v-1' },
        donnees: { kilometrage: 82000 },
      }),
    ).resolves.toBeUndefined();
  });

  it('propage l\'échec si l\'écriture SQL échoue (aucun avalage d\'erreur)', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('contrainte violée'));
    const tx = { execute } as unknown as TransactionDfa;
    const service = new ServiceEvenementsImpl(horlogeFigee());

    await expect(
      service.publier(tx, CTX, {
        type: 'client.fusionne',
        versionSchema: 1,
        siteId: null,
        ressource: { type: 'client', id: 'c-1' },
        donnees: {},
      }),
    ).rejects.toThrow('contrainte violée');
  });
});
