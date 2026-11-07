import { describe, expect, it, vi } from 'vitest';
import type { ContexteTenant, TransactionDfa } from '../db';

vi.mock('./vehicule-requetes', () => ({
  chargerLigneVehicule: vi.fn(),
  lireDernierKilometrage: vi.fn(async () => ({ valeurKm: 84_500 })),
  listerTravauxReportes: vi.fn(),
}));

import { ServiceVehiculeTravailReporte } from './service-vehicule-travail-reporte';

const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'user-1', requeteId: 'req-1' };
const MAINTENANT = new Date('2026-11-07T09:00:00.000Z');

function fabrique(orTrouve: boolean) {
  const returning = vi.fn(async () => [
    {
      id: 'tr-1',
      tenantId: 'tenant-a',
      vehiculeId: 'v-1',
      designation: 'Courroie',
      detail: null,
      urgence: 'a_faire',
      montantEstimeCentimes: null,
      kmConstat: 84_500,
      dateConstat: '2026-11-07',
      ordreReparationOrigineId: null,
      ligneOrOrigineId: null,
      securite: false,
      statut: 'ouvert',
      ordreReparationRepriseId: null,
      motifRefus: null,
      motifModification: null,
    },
  ]);
  const values = vi.fn(() => ({ returning }));
  const insert = vi.fn(() => ({ values }));
  const limit = vi.fn(async () => (orTrouve ? [{ id: 'or-1' }] : []));
  const select = vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) }));
  const tx = { select, insert } as unknown as TransactionDfa;
  const acces = {
    enTenant: vi.fn(async (_c: ContexteTenant, f: (t: TransactionDfa) => unknown) => f(tx)),
  };
  return { service: new ServiceVehiculeTravailReporte(acces as never), values, insert, select };
}

describe('ServiceVehiculeTravailReporte.creer (saisie directe, RM-73)', () => {
  it('saisie libre : insère un travail ouvert, urgence a_faire par défaut, km et date du jour, sans origine', async () => {
    const { service, values, select } = fabrique(false);

    const reponse = await service.creer(
      CTX,
      'v-1',
      { designation: 'Courroie' },
      'technicien',
      MAINTENANT,
    );

    expect(select).not.toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        vehiculeId: 'v-1',
        designation: 'Courroie',
        urgence: 'a_faire',
        securite: false,
        kmConstat: 84_500,
        dateConstat: '2026-11-07',
        ordreReparationOrigineId: null,
        statut: 'ouvert',
      }),
    );
    expect(reponse.statut).toBe('ouvert');
    // technicien : pas de montant dans la réponse (ROLES_SANS_MONTANT).
    expect('montantEstimeCentimes' in reponse).toBe(false);
  });

  it('refuse un OR qui n’appartient pas à ce véhicule/tenant : 404, rien n’est inséré', async () => {
    const { service, insert } = fabrique(false);

    await expect(
      service.creer(
        CTX,
        'v-1',
        {
          designation: 'Courroie',
          ordreReparationOrigineId: '00000000-0000-4000-8000-000000000001',
        },
        'receptionnaire',
        MAINTENANT,
      ),
    ).rejects.toMatchObject({ code: 'RESSOURCE_INTROUVABLE' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('OR du véhicule : le lien est conservé, détail blanc normalisé en null', async () => {
    const { service, values } = fabrique(true);

    await service.creer(
      CTX,
      'v-1',
      {
        designation: 'Courroie',
        detail: 'à prévoir',
        ordreReparationOrigineId: '00000000-0000-4000-8000-000000000001',
      },
      'receptionnaire',
      MAINTENANT,
    );

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: 'à prévoir',
        ordreReparationOrigineId: '00000000-0000-4000-8000-000000000001',
      }),
    );
  });
});
