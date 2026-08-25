import { describe, expect, it } from 'vitest';
import { decoderChaineDbf, encodageDepuisOctetPageDeCode } from './codepages';

describe('decoderChaineDbf', () => {
  it('décode les accents français en cp850 (é, è, à, ç)', () => {
    // "café" en cp850 : c=0x63 a=0x61 f=0x66 é=0x82
    const brut = Buffer.from([0x63, 0x61, 0x66, 0x82]);
    expect(decoderChaineDbf(brut, 'cp850')).toBe('café');
  });

  it('décode les accents allemands en cp850 (ä, ö, ü)', () => {
    // "Müller" : M=0x4D ü=0x81 l=0x6C l=0x6C e=0x65 r=0x72
    const brut = Buffer.from([0x4d, 0x81, 0x6c, 0x6c, 0x65, 0x72]);
    expect(decoderChaineDbf(brut, 'cp850')).toBe('Müller');
  });

  it('décode les accents français en cp1252 (é=0xE9)', () => {
    const brut = Buffer.from([0x63, 0x61, 0x66, 0xe9]);
    expect(decoderChaineDbf(brut, 'cp1252')).toBe('café');
  });

  it('cp850 et cp1252 divergent sur le même octet 0x82 (piège mesuré : ne pas mélanger)', () => {
    // 0x82 = é en cp850, mais , (virgule basse) en cp1252 : preuve que le choix d'encodage compte.
    const brut = Buffer.from([0x82]);
    expect(decoderChaineDbf(brut, 'cp850')).toBe('é');
    expect(decoderChaineDbf(brut, 'cp1252')).not.toBe('é');
  });

  it("latin1 est l'identité octet -> point de code", () => {
    expect(decoderChaineDbf(Buffer.from([0xe9]), 'latin1')).toBe('é');
  });

  it('ascii remplace les octets hauts par le caractère de remplacement', () => {
    expect(decoderChaineDbf(Buffer.from([0x41, 0xe9]), 'ascii')).toBe('A�');
  });

  it('se replie sur cp850 pour un encodage inconnu plutôt que de planter', () => {
    const brut = Buffer.from([0x82]);
    expect(decoderChaineDbf(brut, 'zorglub')).toBe('é');
  });
});

describe('encodageDepuisOctetPageDeCode', () => {
  it('mappe 0x03/0x57/0x58/0x59 (Windows ANSI) vers cp1252', () => {
    expect(encodageDepuisOctetPageDeCode(0x03)).toBe('cp1252');
    expect(encodageDepuisOctetPageDeCode(0x59)).toBe('cp1252');
  });

  it('mappe les octets DOS connus vers cp850', () => {
    expect(encodageDepuisOctetPageDeCode(0x02)).toBe('cp850');
  });

  it('se replie sur cp850 quand la page de code est non déclarée (0x00)', () => {
    expect(encodageDepuisOctetPageDeCode(0x00)).toBe('cp850');
  });

  it('se replie sur cp850 pour un octet totalement inconnu', () => {
    expect(encodageDepuisOctetPageDeCode(0xfe)).toBe('cp850');
  });
});
