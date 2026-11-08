import { describe, expect, it } from 'vitest';

import { champsAdresseManquants } from './adresse';

describe('champsAdresseManquants', () => {
  it('numéro facultatif, rue/NPA/localité requis', () => {
    expect(
      champsAdresseManquants({ rue: 'Rue du Lac', numero: '', npa: '1950', localite: 'Sion' }),
    ).toEqual([]);
    expect(champsAdresseManquants({ rue: ' ', numero: '', npa: '', localite: 'Sion' })).toEqual([
      'rue',
      'npa',
    ]);
  });
});
