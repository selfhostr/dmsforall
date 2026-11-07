import { describe, expect, it } from 'vitest';

import i18n from '@/i18n';
import { ErreurApi } from '@/api/erreurs';

import { messageErreurPointage } from './libelles';

const t = i18n.t.bind(i18n);

function refus(blocages?: unknown): ErreurApi {
  return new ErreurApi({
    type: 'about:blank',
    title: 'Pointage depuis la borne d’un autre site',
    status: 403,
    code: 'POINTAGE_SITE_AUTRE',
    instance: '',
    ...(blocages === undefined ? {} : { blocages }),
  } as never);
}

describe('messageErreurPointage', () => {
  it('nomme le site de l’OR quand le serveur le donne', () => {
    const erreur = refus([
      {
        type: 'ordre_reparation',
        id: 'x',
        libelle: 'Martigny',
        donnees: { siteId: 's2', siteNom: 'Martigny' },
      },
    ]);
    expect(messageErreurPointage(erreur, t)).toBe(
      'Cet OR est au site Martigny ; pointez depuis la borne de ce site ou demandez au bureau.',
    );
  });

  it('retombe sur le message du code, sans nom, quand le site n’est pas donné', () => {
    expect(messageErreurPointage(refus(), t)).toBe(
      "Cet OR est au site d'une autre borne ; pointez depuis la borne de ce site ou demandez au bureau.",
    );
  });

  it('ne dit jamais « pas les droits » pour ce refus', () => {
    expect(messageErreurPointage(refus(), t)).not.toMatch(/droits/i);
  });
});
