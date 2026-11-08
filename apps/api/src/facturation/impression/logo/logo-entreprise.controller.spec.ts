import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';

import type { ServiceContexteRequete } from '../../../common/contexte';

import { LogoEntrepriseController } from './logo-entreprise.controller';
import type { ServiceLogoEntreprise } from './service-logo-entreprise';

function reponseEspion() {
  const res = {
    status: vi.fn(),
    setHeader: vi.fn(),
    send: vi.fn(),
  };
  res.status.mockReturnValue(res);
  res.setHeader.mockReturnValue(res);
  return res;
}

function controleur(logo: { contenu: Buffer; typeMime: string } | null) {
  const service = { lire: vi.fn().mockResolvedValue(logo) } as unknown as ServiceLogoEntreprise;
  const contexte = {
    contexteTenant: () => ({ tenantId: 't', utilisateurId: 'u', requeteId: null }),
  } as unknown as ServiceContexteRequete;
  return new LogoEntrepriseController(service, contexte);
}

describe('GET /parametres-entreprise/logo — absence de logo', () => {
  it('sans paramètre : 404 RESSOURCE_INTROUVABLE (rétrocompatible)', async () => {
    const res = reponseEspion();
    await expect(controleur(null).lire(res as unknown as Response)).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
    });
    expect(res.send).not.toHaveBeenCalled();
  });

  it('absence=vide : 204 sans corps, aucune erreur', async () => {
    const res = reponseEspion();
    await controleur(null).lire(res as unknown as Response, 'vide');
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalledWith();
  });

  it('absence=autre : traité comme sans paramètre (404)', async () => {
    const res = reponseEspion();
    await expect(controleur(null).lire(res as unknown as Response, 'x')).rejects.toMatchObject({
      code: 'RESSOURCE_INTROUVABLE',
    });
  });

  it('logo présent : 200 avec son type, absence=vide sans effet', async () => {
    const res = reponseEspion();
    const contenu = Buffer.from([1, 2, 3]);
    await controleur({ contenu, typeMime: 'image/png' }).lire(res as unknown as Response, 'vide');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(res.send).toHaveBeenCalledWith(contenu);
  });
});
