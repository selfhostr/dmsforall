import { describe, expect, it, vi } from 'vitest';
import { LIMITE_TAILLE_PHOTO_LIGNE_OCTETS } from '@dfa/shared';

import type { PrincipalAuthentifie } from '../../common/contexte/contexte-requete.types';
import type { AccesBase, ContexteTenant } from '../../db';

import type { PortStockagePhotos } from './stockage-photos';
import { ServicePhotosLigne } from './service-photos-ligne';

const CTX: ContexteTenant = { tenantId: 't1', utilisateurId: 'u1', requeteId: null };
const PRINCIPAL = { utilisateurId: 'u1', role: 'technicien' } as unknown as PrincipalAuthentifie;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]);

function creer() {
  const acces = { enTenant: vi.fn() } as unknown as AccesBase;
  const stockage: PortStockagePhotos = {
    ecrire: vi.fn(),
    lire: vi.fn(),
    supprimer: vi.fn(),
    purgerTenant: vi.fn(),
  };
  return { service: new ServicePhotosLigne(acces, stockage), acces, stockage };
}

describe('ServicePhotosLigne.ajouter — refus avant tout accès base ou disque', () => {
  it.each([
    ['photo vide', Buffer.alloc(0), /vide/],
    ['HTML déguisé en image', Buffer.from('<html></html>'), /non reconnu/],
    [
      'HEIC',
      Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(8)]),
      /HEIC/,
    ],
    ['plus de 8 Mo', Buffer.alloc(LIMITE_TAILLE_PHOTO_LIGNE_OCTETS + 1, 0xff), /8 Mo/],
  ])('%s -> VALIDATION_ECHOUEE', async (_nom, buffer, motif) => {
    const { service, acces, stockage } = creer();
    await expect(
      service.ajouter(CTX, PRINCIPAL, 'o', 'l', { photo: { buffer } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE', message: expect.stringMatching(motif) });
    expect(acces.enTenant).not.toHaveBeenCalled();
    expect(stockage.ecrire).not.toHaveBeenCalled();
  });

  it('vignette non JPEG ou trop lourde -> refusée', async () => {
    const { service, acces } = creer();
    await expect(
      service.ajouter(CTX, PRINCIPAL, 'o', 'l', {
        photo: { buffer: JPEG },
        vignette: { buffer: Buffer.from('pas une image') },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
    await expect(
      service.ajouter(CTX, PRINCIPAL, 'o', 'l', {
        photo: { buffer: JPEG },
        vignette: { buffer: Buffer.concat([JPEG, Buffer.alloc(600 * 1024)]) },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
    expect(acces.enTenant).not.toHaveBeenCalled();
  });

  it('transaction en échec -> les fichiers déjà écrits sont retirés', async () => {
    const { service, acces, stockage } = creer();
    (acces.enTenant as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boum'));
    await expect(
      service.ajouter(CTX, PRINCIPAL, 'o', 'l', { photo: { buffer: JPEG } }),
    ).rejects.toThrow('boum');
    expect(stockage.supprimer).not.toHaveBeenCalled(); // rien n'avait été écrit
  });
});
