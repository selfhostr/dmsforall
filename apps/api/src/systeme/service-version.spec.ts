import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from '../config';
import { DUREE_CACHE_ECHEC_MS, DUREE_CACHE_MS, ServiceVersion } from './service-version';

const RELEASE = {
  tag_name: 'v0.4.0',
  html_url: 'https://github.com/selfhostr/dmsforall/releases/tag/v0.4.0',
};

function creer(version = '0.3.0+abc1234', verifier = true, corps: unknown = RELEASE) {
  const fetcher = vi.fn(async () => ({ ok: true, json: async () => corps }));
  const config = { VERSION_APP: version, VERIFIER_MISE_A_JOUR: verifier } as Config;
  return { service: new ServiceVersion(config, fetcher), fetcher };
}

describe('ServiceVersion', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('signale une version plus récente', async () => {
    const { service } = creer();
    expect(await service.obtenir()).toEqual({
      actuelle: '0.3.0',
      derniere: '0.4.0',
      miseAJourDisponible: true,
      urlNotes: RELEASE.html_url,
    });
  });

  it('ne signale rien si on est à jour ou en avance', async () => {
    expect((await creer('0.4.0').service.obtenir()).miseAJourDisponible).toBe(false);
    expect((await creer('0.10.0').service.obtenir()).miseAJourDisponible).toBe(false);
  });

  it('met en cache 12 h puis réinterroge', async () => {
    const { service, fetcher } = creer();
    await service.obtenir();
    await service.obtenir();
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(DUREE_CACHE_MS + 1);
    await service.obtenir();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('échec réseau : derniere null, pas d’erreur, cache court', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('réseau'));
    const service = new ServiceVersion(
      { VERSION_APP: '0.3.0', VERIFIER_MISE_A_JOUR: true } as Config,
      fetcher,
    );
    expect(await service.obtenir()).toEqual({
      actuelle: '0.3.0',
      derniere: null,
      miseAJourDisponible: false,
      urlNotes: null,
    });
    await service.obtenir();
    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(DUREE_CACHE_ECHEC_MS + 1);
    await service.obtenir();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('réponse inattendue ou URL hors GitHub : derniere null', async () => {
    expect((await creer('0.3.0', true, { tag_name: 'x' }).service.obtenir()).derniere).toBeNull();
    const hostile = { tag_name: 'v9.0.0', html_url: 'https://evil.example/x' };
    expect((await creer('0.3.0', true, hostile).service.obtenir()).miseAJourDisponible).toBe(false);
  });

  it('désactivée : aucun appel sortant', async () => {
    const { service, fetcher } = creer('0.3.0', false);
    expect((await service.obtenir()).derniere).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
