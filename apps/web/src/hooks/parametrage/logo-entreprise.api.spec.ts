import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '@/test/msw/server';

import { recupererLogoEntreprise } from './logo-entreprise.api';

describe('recupererLogoEntreprise', () => {
  it('demande absence=vide et traite le 204 comme « pas de logo » (null, sans erreur)', async () => {
    let urlVue = '';
    server.use(
      http.get('/api/v1/parametres-entreprise/logo', ({ request }) => {
        urlVue = request.url;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await expect(recupererLogoEntreprise()).resolves.toBeNull();
    expect(new URL(urlVue).searchParams.get('absence')).toBe('vide');
  });

  it('un serveur plus ancien (404) reste lu comme « pas de logo »', async () => {
    server.use(
      http.get('/api/v1/parametres-entreprise/logo', () => new HttpResponse(null, { status: 404 })),
    );
    await expect(recupererLogoEntreprise()).resolves.toBeNull();
  });

  it('un refus de droit reste une erreur', async () => {
    server.use(
      http.get('/api/v1/parametres-entreprise/logo', () => new HttpResponse('{}', { status: 403 })),
    );
    await expect(recupererLogoEntreprise()).rejects.toBeDefined();
  });
});
