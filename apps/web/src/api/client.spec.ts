import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { server } from '@/test/msw/server';

import { lireEnTetesReponse, requeteApi } from './client';
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

  it('envoie idempotencyKey en en-tête Idempotency-Key', async () => {
    let entetesRecues: Headers | undefined;
    server.use(
      http.post('/api/v1/ordres-reparation', ({ request }) => {
        entetesRecues = request.headers;
        return HttpResponse.json({ donnees: { id: 'or-1' }, avertissements: [] }, { status: 201 });
      }),
    );
    await requeteApi('/ordres-reparation', {
      method: 'POST',
      body: JSON.stringify({}),
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });
    expect(entetesRecues?.get('idempotency-key')).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('envoie ifMatch en en-tête If-Match', async () => {
    let entetesRecues: Headers | undefined;
    server.use(
      http.patch('/api/v1/ordres-reparation/or-1', ({ request }) => {
        entetesRecues = request.headers;
        return HttpResponse.json({ donnees: { id: 'or-1' }, avertissements: [] });
      }),
    );
    await requeteApi('/ordres-reparation/or-1', {
      method: 'PATCH',
      body: JSON.stringify({}),
      ifMatch: 'W/"34"',
    });
    expect(entetesRecues?.get('if-match')).toBe('W/"34"');
  });

  it("If-Match est renvoyé depuis l'ETag reçu au GET précédent (round-trip)", async () => {
    server.use(
      http.get('/api/v1/ordres-reparation/or-1', () =>
        HttpResponse.json({ id: 'or-1' }, { headers: { ETag: 'W/"34"' } }),
      ),
    );
    let etagCapture: string | null = null;
    await requeteApi('/ordres-reparation/or-1', {
      surReponse: (reponse) => {
        etagCapture = lireEnTetesReponse(reponse).etag;
      },
    });
    expect(etagCapture).toBe('W/"34"');

    let entetesPatch: Headers | undefined;
    server.use(
      http.patch('/api/v1/ordres-reparation/or-1', ({ request }) => {
        entetesPatch = request.headers;
        return HttpResponse.json({ donnees: { id: 'or-1' }, avertissements: [] });
      }),
    );
    await requeteApi('/ordres-reparation/or-1', {
      method: 'PATCH',
      body: JSON.stringify({}),
      ifMatch: etagCapture ?? undefined,
    });
    expect(entetesPatch?.get('if-match')).toBe('W/"34"');
  });

  it('lireEnTetesReponse expose idempotenceRejeu depuis Idempotency-Rejeu', async () => {
    server.use(
      http.post('/api/v1/clients', () =>
        HttpResponse.json(
          { donnees: { id: 'client-1' }, avertissements: [] },
          { status: 201, headers: { 'Idempotency-Rejeu': 'true' } },
        ),
      ),
    );
    let rejeuCapture: boolean | undefined;
    await requeteApi('/clients', {
      method: 'POST',
      body: JSON.stringify({}),
      surReponse: (reponse) => {
        rejeuCapture = lireEnTetesReponse(reponse).idempotenceRejeu;
      },
    });
    expect(rejeuCapture).toBe(true);
  });

  it("une réponse 2xx portant des avertissements n'est jamais traitée comme une erreur", async () => {
    server.use(
      http.post('/api/v1/clients', () =>
        HttpResponse.json(
          {
            donnees: { id: 'client-1' },
            avertissements: [{ code: 'CLIENT_DOUBLON_PROBABLE', message: 'Doublon probable', donnees: {} }],
          },
          { status: 201 },
        ),
      ),
    );
    const resultat = await requeteApi<{ donnees: { id: string }; avertissements: unknown[] }>('/clients', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(resultat?.donnees.id).toBe('client-1');
    expect(resultat?.avertissements).toHaveLength(1);
  });
});
