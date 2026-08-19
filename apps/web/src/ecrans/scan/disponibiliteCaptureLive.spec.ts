import { afterEach, describe, expect, it, vi } from 'vitest';

import { estCaptureLiveDisponible } from './disponibiliteCaptureLive';

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
});

describe('estCaptureLiveDisponible', () => {
  it('faux sur une origine NON sécurisée, même si getUserMedia existe — jamais de tentative caméra', () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn() },
    } as unknown as Navigator);

    expect(estCaptureLiveDisponible()).toBe(false);
  });

  it('faux sur une origine sécurisée sans mediaDevices.getUserMedia (navigateur trop ancien)', () => {
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    vi.stubGlobal('navigator', {} as unknown as Navigator);

    expect(estCaptureLiveDisponible()).toBe(false);
  });

  it('vrai seulement quand les DEUX conditions sont réunies : origine sécurisée ET getUserMedia disponible', () => {
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn() },
    } as unknown as Navigator);

    expect(estCaptureLiveDisponible()).toBe(true);
  });
});
