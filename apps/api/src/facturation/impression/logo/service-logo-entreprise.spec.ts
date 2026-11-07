import { describe, expect, it } from 'vitest';
import { LIMITE_TAILLE_LOGO_OCTETS } from '@dfa/shared';

import type { ContexteTenant } from '../../../db';
import type { StockagePdf } from '../stockage-pdf';

import { cleLogo, lireLogoImprimable, ServiceLogoEntreprise } from './service-logo-entreprise';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);
const CTX: ContexteTenant = { tenantId: 'tenant-a', utilisateurId: 'u', requeteId: null };

function stockageMemoire(): StockagePdf & { fichiers: Map<string, Buffer> } {
  const fichiers = new Map<string, Buffer>();
  return {
    fichiers,
    ecrire: (cle, buffer) => {
      fichiers.set(cle, buffer);
      return Promise.resolve();
    },
    lire: (cle) => {
      const f = fichiers.get(cle);
      return f
        ? Promise.resolve(f)
        : Promise.reject(Object.assign(new Error('absent'), { code: 'ENOENT' }));
    },
    supprimer: (cle) => {
      fichiers.delete(cle);
      return Promise.resolve();
    },
    purgerTenant: () => Promise.resolve(),
  };
}

describe('ServiceLogoEntreprise', () => {
  it('dépose sous la clé du tenant de la session et relit le même octet', async () => {
    const stockage = stockageMemoire();
    const service = new ServiceLogoEntreprise(stockage);
    expect(await service.remplacer(CTX, PNG)).toEqual({
      typeMime: 'image/png',
      tailleOctets: PNG.length,
    });
    expect([...stockage.fichiers.keys()]).toEqual([cleLogo('tenant-a')]);
    expect((await service.lire(CTX))?.typeMime).toBe('image/png');
  });

  it('refuse vide, trop gros et format inconnu sans rien écrire', async () => {
    const stockage = stockageMemoire();
    const service = new ServiceLogoEntreprise(stockage);
    await expect(service.remplacer(CTX, Buffer.alloc(0))).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
    });
    await expect(
      service.remplacer(CTX, Buffer.concat([PNG, Buffer.alloc(LIMITE_TAILLE_LOGO_OCTETS)])),
    ).rejects.toMatchObject({ code: 'VALIDATION_ECHOUEE' });
    await expect(service.remplacer(CTX, Buffer.from('%PDF-1.7'))).rejects.toMatchObject({
      code: 'VALIDATION_ECHOUEE',
    });
    expect(stockage.fichiers.size).toBe(0);
  });

  it('un autre tenant ne voit pas le logo ; lire sans logo rend null ; supprimer est idempotent', async () => {
    const stockage = stockageMemoire();
    const service = new ServiceLogoEntreprise(stockage);
    await service.remplacer(CTX, PNG);
    expect(await service.lire({ ...CTX, tenantId: 'tenant-b' })).toBeNull();
    await service.supprimer(CTX);
    await service.supprimer(CTX);
    expect(await service.lire(CTX)).toBeNull();
  });

  it('un fichier altéré sur disque n’est jamais servi', async () => {
    const stockage = stockageMemoire();
    stockage.fichiers.set(cleLogo('tenant-a'), Buffer.from('%PDF-1.7'));
    expect(await new ServiceLogoEntreprise(stockage).lire(CTX)).toBeNull();
  });
});

describe('lireLogoImprimable', () => {
  it('PNG imprimable, SVG non (pdfkit ne le rend pas), absent null', async () => {
    const stockage = stockageMemoire();
    expect(await lireLogoImprimable(stockage, 'tenant-a')).toBeNull();
    stockage.fichiers.set(cleLogo('tenant-a'), PNG);
    expect(await lireLogoImprimable(stockage, 'tenant-a')).toEqual(PNG);
    stockage.fichiers.set(
      cleLogo('tenant-a'),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    );
    expect(await lireLogoImprimable(stockage, 'tenant-a')).toBeNull();
  });
});
