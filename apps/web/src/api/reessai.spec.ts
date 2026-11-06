import { describe, expect, it } from 'vitest';

import { CODES_ERREUR, type ProblemeDetail } from '@dfa/shared';

import { ErreurApi, ErreurReseau } from './erreurs';
import { doitReessayerParDefaut } from './reessai';

function erreurApi(status: number): ErreurApi {
  return new ErreurApi({
    type: 'about:blank',
    title: 't',
    status,
    code: CODES_ERREUR[0],
    instance: 'req-1',
  } as ProblemeDetail);
}

describe('doitReessayerParDefaut', () => {
  it('ne rejoue jamais une réponse 4xx', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(doitReessayerParDefaut(0, erreurApi(status))).toBe(false);
    }
  });

  it('rejoue deux fois une panne serveur puis abandonne', () => {
    expect(doitReessayerParDefaut(0, erreurApi(503))).toBe(true);
    expect(doitReessayerParDefaut(1, erreurApi(500))).toBe(true);
    expect(doitReessayerParDefaut(2, erreurApi(500))).toBe(false);
  });

  it('rejoue une panne réseau', () => {
    expect(doitReessayerParDefaut(0, new ErreurReseau())).toBe(true);
    expect(doitReessayerParDefaut(2, new ErreurReseau())).toBe(false);
  });
});
