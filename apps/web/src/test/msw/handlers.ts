import { http, HttpResponse } from 'msw';

import type { SessionCourante } from '@dfa/shared';

export const SESSION_TEST: SessionCourante = {
  utilisateur: {
    id: 'utilisateur-1',
    email: 'jean.dupont@garage.ch',
    prenom: 'Jean',
    nom: 'Dupont',
    role: 'chef_atelier',
    langue: 'fr',
  },
  tenant: {
    id: 'tenant-1',
    slug: 'garage-test',
    raisonSociale: 'Garage Test SA',
    langueDefaut: 'fr',
  },
  sites: [{ id: 'site-1', code: 'PRINCIPAL', nom: 'Site principal', actif: true }],
  expireLe: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
};

/** Handlers par défaut : "non connecté" (401 sur /auth/moi). Chaque test surcharge via
 *  `server.use(...)` selon le scénario voulu. */
export const handlers = [
  http.get('/api/v1/auth/moi', () =>
    HttpResponse.json(
      {
        type: 'https://docs.dmsforall.example/erreurs/AUTH_SESSION_ABSENTE',
        title: 'Session absente',
        status: 401,
        code: 'AUTH_SESSION_ABSENTE',
        instance: 'req-1',
      },
      { status: 401, headers: { 'content-type': 'application/problem+json' } },
    ),
  ),
];
