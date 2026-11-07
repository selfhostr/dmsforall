import { describe, expect, it } from 'vitest';

import { detecterTypeLogo } from './detection-logo';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);

describe('detecterTypeLogo — par les premiers octets', () => {
  it('reconnaît PNG, JPEG et SVG simple', () => {
    expect(detecterTypeLogo(PNG)).toBe('image/png');
    expect(detecterTypeLogo(JPEG)).toBe('image/jpeg');
    expect(
      detecterTypeLogo(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')),
    ).toBe('image/svg+xml');
    expect(
      detecterTypeLogo(
        Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>'),
      ),
    ).toBe('image/svg+xml');
  });

  it('refuse un exécutable ou un PDF déguisé en image, quel que soit le nom', () => {
    expect(detecterTypeLogo(Buffer.from('%PDF-1.7 ...'))).toBeNull();
    expect(detecterTypeLogo(Buffer.from([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
    expect(detecterTypeLogo(Buffer.alloc(0))).toBeNull();
    expect(detecterTypeLogo(Buffer.from('GIF89a'))).toBeNull();
  });

  it('refuse un SVG actif : script, gestionnaire on*, javascript:, foreignObject, ressource externe', () => {
    const svg = (corps: string) =>
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg">${corps}</svg>`);
    expect(detecterTypeLogo(svg('<script>alert(1)</script>'))).toBeNull();
    expect(detecterTypeLogo(svg('<rect onload="alert(1)"/>'))).toBeNull();
    expect(detecterTypeLogo(svg('<a href="javascript:alert(1)"><rect/></a>'))).toBeNull();
    expect(detecterTypeLogo(svg('<foreignObject><div/></foreignObject>'))).toBeNull();
    expect(detecterTypeLogo(svg('<image href="https://evil.example/x.png"/>'))).toBeNull();
  });

  it('refuse un texte qui n’est pas un SVG, ou un binaire contenant un octet nul', () => {
    expect(detecterTypeLogo(Buffer.from('<html><body/></html>'))).toBeNull();
    expect(
      detecterTypeLogo(Buffer.concat([Buffer.from('<svg'), Buffer.from([0]), Buffer.from('>')])),
    ).toBeNull();
  });
});
