import { describe, expect, it } from 'vitest';

import { quantiteDisponibleMillieme } from './utils';

const STOCKS = [
  { siteId: 'a', quantiteDisponibleMillieme: 3000 },
  { siteId: 'b', quantiteDisponibleMillieme: 5000 },
];

describe('quantiteDisponibleMillieme', () => {
  it('somme tous les sites sans site', () => {
    expect(quantiteDisponibleMillieme(STOCKS, undefined)).toBe(8000);
  });
  it('un seul site', () => {
    expect(quantiteDisponibleMillieme(STOCKS, 'b')).toBe(5000);
    expect(quantiteDisponibleMillieme(STOCKS, 'zzz')).toBe(0);
  });
});
