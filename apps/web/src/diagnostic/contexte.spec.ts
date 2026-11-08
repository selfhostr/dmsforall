import { describe, expect, it } from 'vitest';

import { decrireNavigateur, versionApplication } from './contexte';

describe('decrireNavigateur', () => {
  it.each([
    [
      'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
      'Firefox 140 / Linux',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      'Edge 130 / Windows',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Chrome 130 / Windows',
    ],
    [
      'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'Safari 17 / iOS',
    ],
    ['', 'inconnu / inconnu'],
  ])('%s', (ua, attendu) => {
    expect(decrireNavigateur(ua)).toBe(attendu);
  });
});

describe('versionApplication', () => {
  it('garde le numéro avant le premier « + »', () => {
    expect(versionApplication('0.2.0+abc1234+modifié')).toBe('0.2.0');
  });
  it('absente ou invalide : « inconnue »', () => {
    expect(versionApplication(undefined)).toBe('inconnue');
    expect(versionApplication('inconnu')).toBe('inconnue');
  });
});
