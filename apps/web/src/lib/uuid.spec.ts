import { afterEach, describe, expect, it } from 'vitest';

import { genererUuid } from './uuid';

const REGEX_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('genererUuid', () => {
  it('produit un uuid v4 valide quand crypto.randomUUID est disponible (le cas normal, localhost)', () => {
    expect(typeof crypto.randomUUID).toBe('function');
    expect(genererUuid()).toMatch(REGEX_UUID_V4);
  });

  describe('repli sans crypto.randomUUID (accès réseau HTTP sur IP locale, hors contexte sécurisé)', () => {
    const randomUUIDOriginal = crypto.randomUUID;

    afterEach(() => {
      // Restauration systématique : ce test manipule un global partagé par toute la suite.
      crypto.randomUUID = randomUUIDOriginal;
    });

    it('produit tout de même un uuid v4 valide via crypto.getRandomValues', () => {
      // @ts-expect-error — simule l'environnement réel où `crypto.randomUUID` est `undefined`
      // (WebCrypto `[SecureContext]`, absente en HTTP hors localhost).
      crypto.randomUUID = undefined;

      expect(genererUuid()).toMatch(REGEX_UUID_V4);
    });

    it('produit une valeur distincte à chaque appel', () => {
      // @ts-expect-error — même simulation que le test précédent.
      crypto.randomUUID = undefined;

      expect(genererUuid()).not.toBe(genererUuid());
    });
  });
});
