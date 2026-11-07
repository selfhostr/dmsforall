import { describe, expect, it } from 'vitest';

import { peutAjouterPhoto } from './droits';
import { dimensionsReduites } from './preparer-photo';

describe('dimensionsReduites', () => {
  it('ramène le plus grand côté au plafond en gardant les proportions', () => {
    expect(dimensionsReduites(4000, 3000, 1920)).toEqual({ largeur: 1920, hauteur: 1440 });
    expect(dimensionsReduites(3000, 4000, 320)).toEqual({ largeur: 240, hauteur: 320 });
  });

  it('n’agrandit jamais une image déjà plus petite que le plafond', () => {
    expect(dimensionsReduites(800, 600, 1920)).toEqual({ largeur: 800, hauteur: 600 });
  });
});

describe('peutAjouterPhoto', () => {
  it('le terrain et l’encadrement oui ; vendeur, comptable, borne et inconnu non', () => {
    for (const role of [
      'admin',
      'direction',
      'receptionnaire',
      'chef_atelier',
      'technicien',
      'magasinier',
    ] as const) {
      expect(peutAjouterPhoto(role)).toBe(true);
    }
    for (const role of ['vendeur', 'comptable', 'poste_atelier'] as const) {
      expect(peutAjouterPhoto(role)).toBe(false);
    }
    expect(peutAjouterPhoto(undefined)).toBe(false);
  });
});
