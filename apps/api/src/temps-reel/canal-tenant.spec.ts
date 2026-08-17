import { describe, expect, it } from 'vitest';

import { canalTenant, tenantIdDepuisCanal } from './canal-tenant';

describe('canalTenant / tenantIdDepuisCanal', () => {
  it('produit un canal préfixé et le fait round-tripper', () => {
    const tenantId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    const canal = canalTenant(tenantId);
    expect(canal).toBe('dfa:temps-reel:3fa85f64-5717-4562-b3fc-2c963f66afa6');
    expect(tenantIdDepuisCanal(canal)).toBe(tenantId);
  });

  it('deux tenants distincts produisent deux canaux distincts', () => {
    expect(canalTenant('tenant-a')).not.toBe(canalTenant('tenant-b'));
  });

  it('rend null pour un canal hors de ce module (aucun préfixe reconnu)', () => {
    expect(tenantIdDepuisCanal('autre:canal:xyz')).toBeNull();
  });

  it('rend null pour un canal réduit au seul préfixe (tenantId vide)', () => {
    expect(tenantIdDepuisCanal('dfa:temps-reel:')).toBeNull();
  });
});
