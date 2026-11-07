import { describe, expect, it } from 'vitest';

import { detecterTypeImage } from './detection-image';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const heic = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypheic'),
  Buffer.alloc(8),
]);

describe('detecterTypeImage', () => {
  it('reconnaît JPEG, PNG et HEIC par les octets, pas par un nom', () => {
    expect(detecterTypeImage(jpeg)).toBe('image/jpeg');
    expect(detecterTypeImage(png)).toBe('image/png');
    expect(detecterTypeImage(heic)).toBe('heic');
  });

  it('refuse du texte, du HTML, un exécutable et un tampon vide', () => {
    expect(detecterTypeImage(Buffer.from('<html><script>alert(1)</script>'))).toBe('inconnu');
    expect(detecterTypeImage(Buffer.from('MZ\x90\x00'))).toBe('inconnu');
    expect(detecterTypeImage(Buffer.from('GIF89a'))).toBe('inconnu');
    expect(detecterTypeImage(Buffer.alloc(0))).toBe('inconnu');
  });

  it('un ftyp non HEIC (mp4) reste inconnu', () => {
    const mp4 = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from('ftypisom'),
      Buffer.alloc(8),
    ]);
    expect(detecterTypeImage(mp4)).toBe('inconnu');
  });
});
