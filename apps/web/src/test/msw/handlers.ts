import { http, HttpResponse } from 'msw';

import type { SessionCourante } from '@dfa/shared';

import { creerSessionTest } from '../session';

export const SESSION_TEST: SessionCourante = creerSessionTest('chef_atelier');

/** Valeur de fixture pour `GET /sante` — volontairement distincte de tout défaut réel
 *  (`VERSION_APP` de l'API vaut `0.0.0-dev` par défaut, voir `apps/api/src/config/`) pour qu'un
 *  test qui l'affiche ne puisse jamais être confondu avec une coïncidence. */
export const VERSION_TEST = '9.9.9-test';

/** Handlers par défaut : "non connecté" (401 sur /auth/moi) et sonde de vie répondant toujours
 *  (endpoint public, quasiment jamais le sujet direct d'un test). Chaque test surcharge via
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
  // Réglages du garage : refusés par défaut (rôle sans droit) — l'écran qui en dépend retombe sur
  // son comportement sans régime TVA connu. Un test de régime surcharge via `server.use(...)`.
  http.get('/api/v1/parametres-entreprise', () =>
    HttpResponse.json(
      {
        type: 'https://docs.dmsforall.example/erreurs/DROIT_INSUFFISANT',
        title: 'Droit insuffisant',
        status: 403,
        code: 'DROIT_INSUFFISANT',
        instance: 'req-1',
      },
      { status: 403, headers: { 'content-type': 'application/problem+json' } },
    ),
  ),
  http.get('/api/v1/sante', () => HttpResponse.json({ statut: 'ok', version: VERSION_TEST })),
];
