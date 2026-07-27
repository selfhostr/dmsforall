import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '@/test/msw/server';

import { requeteApi } from './client';
import { ErreurApi, ErreurReseau } from './erreurs';

describe('requeteApi', () => {
  it('renvoie undefined sur un 204 sans jamais tenter de parser le corps', async () => {
    server.use(http.post('/api/v1/auth/deconnexion', () => new HttpResponse(null, { status: 204 })));
    await expect(requeteApi('/auth/deconnexion', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('renvoie undefined sur un corps vide même en 200', async () => {
    server.use(http.get('/api/v1/exemple-vide', () => new HttpResponse(null, { status: 200 })));
    await expect(requeteApi('/exemple-vide')).resolves.toBeUndefined();
  });

  it('parse un corps JSON en 200', async () => {
    server.use(http.get('/api/v1/exemple', () => HttpResponse.json({ valeur: 42 })));
    await expect(requeteApi<{ valeur: number }>('/exemple')).resolves.toEqual({ valeur: 42 });
  });

  it('lève ErreurApi sur une réponse problem+json non-ok', async () => {
    server.use(
      http.get('/api/v1/protege', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/DROIT_INSUFFISANT',
            title: 'Droit insuffisant',
            status: 403,
            code: 'DROIT_INSUFFISANT',
            instance: 'req-3',
          },
          { status: 403, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    await expect(requeteApi('/protege')).rejects.toBeInstanceOf(ErreurApi);
  });

  it('lève ErreurReseau si fetch échoue (réseau coupé)', async () => {
    server.use(http.get('/api/v1/injoignable', () => HttpResponse.error()));
    await expect(requeteApi('/injoignable')).rejects.toBeInstanceOf(ErreurReseau);
  });
});
