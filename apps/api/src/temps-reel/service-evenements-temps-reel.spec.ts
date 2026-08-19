import { describe, expect, it, vi } from 'vitest';

import { ServiceEvenementsTempsReel } from './service-evenements-temps-reel';
import type { ClientRedisPublieurTempsReel } from './service-evenements-temps-reel';

describe('ServiceEvenementsTempsReel.publier', () => {
  it('publie sur le canal du tenant, avec le type/donnees/rolesCibles fournis', async () => {
    const publish = vi.fn().mockResolvedValue(1);
    const service = new ServiceEvenementsTempsReel({ publish } as ClientRedisPublieurTempsReel);

    await service.publier(
      'tenant-a',
      'vehicule.correspondance_scan_permis',
      { clientId: 'client-1' },
      ['direction', 'receptionnaire'],
    );

    expect(publish).toHaveBeenCalledTimes(1);
    const [canal, message] = publish.mock.calls[0] as [string, string];
    expect(canal).toBe('dfa:temps-reel:tenant-a');
    const enveloppe = JSON.parse(message) as Record<string, unknown>;
    expect(enveloppe).toMatchObject({
      type: 'vehicule.correspondance_scan_permis',
      donnees: { clientId: 'client-1' },
      rolesCibles: ['direction', 'receptionnaire'],
    });
    expect(typeof enveloppe.emisLe).toBe('string');
  });

  it('accepte une liste de rôles cibles vide (publié quand même, personne ne le recevra)', async () => {
    const publish = vi.fn().mockResolvedValue(0);
    const service = new ServiceEvenementsTempsReel({ publish } as ClientRedisPublieurTempsReel);

    await expect(
      service.publier('tenant-a', 'vehicule.correspondance_scan_permis', { clientId: 'c' }, []),
    ).resolves.toBeUndefined();
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
