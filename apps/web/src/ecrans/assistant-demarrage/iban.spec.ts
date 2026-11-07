import { describe, expect, it } from 'vitest';

import { classerCompte, compacterIban, grouperIban } from './iban';

describe('classerCompte', () => {
  it('IBAN ordinaire : compte « iban »', () => {
    expect(classerCompte('CH93 0076 2011 6238 5295 7')).toEqual({ iban: 'CH9300762011623852957' });
  });
  it('QR-IBAN (IID 30000-31999) : compte « qrIban »', () => {
    expect(classerCompte('ch44 3199 9123 0008 8901 2')).toEqual({
      qrIban: 'CH4431999123000889012',
    });
    expect(classerCompte('CH4430000123000889012')).toEqual({ qrIban: 'CH4430000123000889012' });
  });
  it('bornes de la plage QR : 29999 et 32000 sont des IBAN ordinaires', () => {
    expect(classerCompte('CH4429999123000889012')).toEqual({ iban: 'CH4429999123000889012' });
    expect(classerCompte('CH4432000123000889012')).toEqual({ iban: 'CH4432000123000889012' });
  });
  it('vide : rien à enregistrer', () => {
    expect(classerCompte('   ')).toBeNull();
  });
  it('compacter et grouper', () => {
    expect(compacterIban(' ch93 0076 ')).toBe('CH930076');
    expect(grouperIban('CH9300762011623852957')).toBe('CH93 0076 2011 6238 5295 7');
  });
});
