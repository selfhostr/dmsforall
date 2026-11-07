import { describe, expect, it } from 'vitest';

import { trouverCorrespondance } from './navigation-modele';

describe('onglet Chiffres de Facturation', () => {
  it('/factures/chiffres active Chiffres, pas Factures', () => {
    const c = trouverCorrespondance('/factures/chiffres');
    expect(c?.entree.id).toBe('facturation');
    expect(c?.onglet.id).toBe('chiffres');
  });

  it('/factures reste sur Factures', () => {
    expect(trouverCorrespondance('/factures')?.onglet.id).toBe('factures');
  });
});
