import { describe, expect, it } from 'vitest';

import { chargerEnv, ErreurEnvInvalide } from './env';

describe('chargerEnv', () => {
  it('accepte une config valide', () => {
    expect(chargerEnv({ VITE_API_URL: '/api/v1' })).toEqual({ VITE_API_URL: '/api/v1' });
  });

  it('rejette une VITE_API_URL absente avec toutes les variables fautives listées', () => {
    try {
      chargerEnv({});
      expect.unreachable('chargerEnv aurait dû lever ErreurEnvInvalide');
    } catch (erreur) {
      expect(erreur).toBeInstanceOf(ErreurEnvInvalide);
      const erreurTypee = erreur as ErreurEnvInvalide;
      expect(erreurTypee.problemes.some((p) => p.variable === 'VITE_API_URL')).toBe(true);
    }
  });

  it('rejette une VITE_API_URL vide', () => {
    expect(() => chargerEnv({ VITE_API_URL: '' })).toThrow(ErreurEnvInvalide);
  });
});
