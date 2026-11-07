import { describe, expect, it } from 'vitest';

import { resoudreSiteId, vehiculeParDefaut } from './preselection';

const SION = { id: 'sion' };
const MARTIGNY = { id: 'martigny' };

describe('resoudreSiteId', () => {
  it("l'URL gagne sur tout le reste", () => {
    expect(resoudreSiteId('martigny', 'sion', [SION, MARTIGNY])).toBe('martigny');
  });
  it('sans URL : la préférence du poste, si le site existe encore', () => {
    expect(resoudreSiteId(null, 'sion', [SION, MARTIGNY])).toBe('sion');
    expect(resoudreSiteId(null, 'disparu', [SION, MARTIGNY])).toBeUndefined();
  });
  it('un seul site : présélectionné sans préférence', () => {
    expect(resoudreSiteId(null, undefined, [SION])).toBe('sion');
  });
  it('plusieurs sites sans préférence : rien deviné', () => {
    expect(resoudreSiteId(null, undefined, [SION, MARTIGNY])).toBeUndefined();
  });
});

describe('vehiculeParDefaut', () => {
  it('un seul véhicule : présélectionné', () => {
    expect(vehiculeParDefaut(null, ['golf'], false)).toBe('golf');
  });
  it('plusieurs véhicules : rien de présélectionné', () => {
    expect(vehiculeParDefaut(null, ['golf', 'bmw'], false)).toBeNull();
  });
  it('le choix explicite gagne', () => {
    expect(vehiculeParDefaut('bmw', ['golf', 'bmw'], false)).toBe('bmw');
  });
  it('« continuer sans véhicule » : jamais de présélection', () => {
    expect(vehiculeParDefaut(null, ['golf'], true)).toBeNull();
  });
});
