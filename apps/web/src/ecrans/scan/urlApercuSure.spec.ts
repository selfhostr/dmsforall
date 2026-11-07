import { describe, expect, it } from 'vitest';
import { urlApercuSure } from './urlApercuSure';

describe('urlApercuSure', () => {
  it('accepte blob: et data:image/', () => {
    expect(urlApercuSure('blob:http://localhost/abc')).toBe('blob:http://localhost/abc');
    expect(urlApercuSure('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });
  it('refuse le reste', () => {
    expect(urlApercuSure('javascript:alert(1)')).toBeUndefined();
    expect(urlApercuSure('https://exemple.ch/a.png')).toBeUndefined();
    expect(urlApercuSure('data:text/html,<b>x</b>')).toBeUndefined();
    expect(urlApercuSure('')).toBeUndefined();
    expect(urlApercuSure(null)).toBeUndefined();
  });
});
