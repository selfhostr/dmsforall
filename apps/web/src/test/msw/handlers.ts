import { http, HttpResponse } from 'msw';

import type { SessionCourante } from '@dfa/shared';
import { CAPACITES_TEST } from '@/test/capacites';

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
  // Compte de personne (role: 'chef_atelier') : `siteRattachementId` n'est renseigné que pour les
  // comptes de service (`ROLES_COMPTE_DE_SERVICE`, ex. `poste_atelier`), voir `@dfa/shared`.
  siteRattachementId: null,
  actions: [],
  capacites: CAPACITES_TEST,
  expireLe: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
};

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
  http.get('/api/v1/sante', () => HttpResponse.json({ statut: 'ok', version: VERSION_TEST })),
];
