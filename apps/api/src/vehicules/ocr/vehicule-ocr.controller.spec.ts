import { describe, expect, it, vi } from 'vitest';

import type { ContexteTenant } from '../../db';
import type { ServiceContexteRequete } from '../../common/contexte';
import { VehiculeOcrController } from './vehicule-ocr.controller';
import type { ServiceVehiculeOcr } from './service-vehicule-ocr';

const CTX: ContexteTenant = { tenantId: 'tid-1', utilisateurId: 'u1', requeteId: null };

function contexteFactice(): ServiceContexteRequete {
  return { contexteTenant: vi.fn(() => CTX) } as unknown as ServiceContexteRequete;
}

function fichierFactice(buffer: Buffer): Express.Multer.File {
  return { buffer } as Express.Multer.File;
}

describe('VehiculeOcrController.scannerPermisCirculation', () => {
  it('fichier absent (rejeté par le fileFilter multer, MIME hors liste) -> ErreurMetier VALIDATION_ECHOUEE, le service n’est jamais appelé', async () => {
    const service = { scanner: vi.fn() } as unknown as ServiceVehiculeOcr;
    const controller = new VehiculeOcrController(service, contexteFactice());

    await expect(controller.scannerPermisCirculation(undefined)).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
    });
    expect(service.scanner).not.toHaveBeenCalled();
  });

  it('buffer vide (fichier 0 octet) -> ErreurMetier VALIDATION_ECHOUEE', async () => {
    const service = { scanner: vi.fn() } as unknown as ServiceVehiculeOcr;
    const controller = new VehiculeOcrController(service, contexteFactice());

    await expect(
      controller.scannerPermisCirculation(fichierFactice(Buffer.alloc(0))),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
  });

  it('fichier présent -> délègue au service avec le contexte tenant courant et le buffer reçu', async () => {
    const reponseAttendue = { donneesLues: {} } as unknown as Awaited<
      ReturnType<ServiceVehiculeOcr['scanner']>
    >;
    const service = {
      scanner: vi.fn().mockResolvedValue(reponseAttendue),
    } as unknown as ServiceVehiculeOcr;
    const contexte = contexteFactice();
    const controller = new VehiculeOcrController(service, contexte);
    const buffer = Buffer.from('donnees-image');

    const resultat = await controller.scannerPermisCirculation(fichierFactice(buffer));

    expect(contexte.contexteTenant).toHaveBeenCalledTimes(1);
    expect(service.scanner).toHaveBeenCalledWith(CTX, buffer);
    expect(resultat).toBe(reponseAttendue);
  });
});
