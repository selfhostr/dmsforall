import { describe, expect, it, vi } from 'vitest';

import type { ServiceContexteRequete } from '../../common/contexte';

import { PhotosLigneController } from './photos-ligne.controller';
import type { ServicePhotosLigne } from './service-photos-ligne';

const ID = '3f1c9a52-6d2e-4a8b-9c11-0a1b2c3d4e5f';

function monter() {
  const service = {
    ajouter: vi.fn().mockResolvedValue({ id: 'p' }),
    supprimer: vi.fn(),
  } as unknown as ServicePhotosLigne;
  const contexte = {
    contexteTenant: vi.fn(() => ({ tenantId: 't' })),
    exigerPrincipal: vi.fn(() => ({ utilisateurId: 'u' })),
  } as unknown as ServiceContexteRequete;
  return { service, controller: new PhotosLigneController(service, contexte) };
}

describe('PhotosLigneController.ajouter', () => {
  it('sans fichier `photo` -> VALIDATION_ECHOUEE, service non appelé', async () => {
    const { service, controller } = monter();
    await expect(controller.ajouter(ID, ID, {}, {})).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
    });
    await expect(controller.ajouter(ID, ID, undefined, undefined)).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
    });
    expect(service.ajouter).not.toHaveBeenCalled();
  });

  it('transmet photo, vignette et légende nettoyée', async () => {
    const { service, controller } = monter();
    const photo = { buffer: Buffer.from('p') } as Express.Multer.File;
    const vignette = { buffer: Buffer.from('v') } as Express.Multer.File;
    await controller.ajouter(
      ID,
      ID,
      { photo: [photo], vignette: [vignette] },
      { legende: '  Disque rayé ' },
    );
    expect(service.ajouter).toHaveBeenCalledWith(
      { tenantId: 't' },
      { utilisateurId: 'u' },
      ID,
      ID,
      { photo, vignette, legende: 'Disque rayé' },
    );
  });

  it('légende de plus de 200 caractères -> refusée', async () => {
    const { controller } = monter();
    const photo = { buffer: Buffer.from('p') } as Express.Multer.File;
    await expect(
      controller.ajouter(ID, ID, { photo: [photo] }, { legende: 'x'.repeat(201) }),
    ).rejects.toBeDefined();
  });
});
