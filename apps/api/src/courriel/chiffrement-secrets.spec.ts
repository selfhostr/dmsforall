import { describe, expect, it } from 'vitest';

import {
  chiffrerSecret,
  decoderCleChiffrement,
  dechiffrerSecret,
  ErreurDechiffrementSecret,
} from './chiffrement-secrets';

const CLE = Buffer.alloc(32, 3);
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

describe('decoderCleChiffrement', () => {
  it('accepte 32 octets en base64 et 64 caractères hexadécimaux', () => {
    expect(decoderCleChiffrement(CLE.toString('base64'))?.equals(CLE)).toBe(true);
    expect(decoderCleChiffrement(CLE.toString('hex'))?.equals(CLE)).toBe(true);
  });

  it('refuse une clé trop courte, trop longue ou illisible', () => {
    expect(decoderCleChiffrement(Buffer.alloc(16).toString('base64'))).toBeNull();
    expect(decoderCleChiffrement(Buffer.alloc(33).toString('base64'))).toBeNull();
    expect(decoderCleChiffrement('pas une clé !')).toBeNull();
    expect(decoderCleChiffrement('')).toBeNull();
  });
});

describe('chiffrerSecret / dechiffrerSecret', () => {
  it('aller-retour exact, y compris avec accents et caractères spéciaux', () => {
    const clair = 'Mot-de-passe é€ "quote" \\ $HOME 日本';
    expect(dechiffrerSecret(chiffrerSecret(clair, CLE, TENANT_A), CLE, TENANT_A)).toBe(clair);
  });

  it('le texte chiffré ne contient pas le clair et change à chaque chiffrement (IV aléatoire)', () => {
    const a = chiffrerSecret('secret-visible', CLE, TENANT_A);
    const b = chiffrerSecret('secret-visible', CLE, TENANT_A);
    expect(a).not.toBe(b);
    expect(a.startsWith('v1.')).toBe(true);
    expect(a).not.toContain('secret-visible');
  });

  it('un secret copié vers un autre garage ne se déchiffre pas (lié au tenant)', () => {
    const stocke = chiffrerSecret('secret', CLE, TENANT_A);
    expect(() => dechiffrerSecret(stocke, CLE, TENANT_B)).toThrow(ErreurDechiffrementSecret);
  });

  it('une autre clé, un texte altéré ou un format inconnu sont refusés', () => {
    const stocke = chiffrerSecret('secret', CLE, TENANT_A);
    expect(() => dechiffrerSecret(stocke, Buffer.alloc(32, 9), TENANT_A)).toThrow(
      ErreurDechiffrementSecret,
    );
    const [v, iv, tag, chiffre] = stocke.split('.');
    const altere = [v, iv, tag, Buffer.from('xx').toString('base64url') + chiffre].join('.');
    expect(() => dechiffrerSecret(altere, CLE, TENANT_A)).toThrow(ErreurDechiffrementSecret);
    expect(() => dechiffrerSecret('v2.a.b.c', CLE, TENANT_A)).toThrow(ErreurDechiffrementSecret);
    expect(() => dechiffrerSecret('n-importe-quoi', CLE, TENANT_A)).toThrow(
      ErreurDechiffrementSecret,
    );
  });
});
