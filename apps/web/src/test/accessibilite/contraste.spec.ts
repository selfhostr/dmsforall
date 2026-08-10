import { describe, expect, it } from 'vitest';

import { analyserHsl, hslVersRgb, ratioContraste } from './contraste';

/** Auto-test du moteur de calcul, sur des valeurs de référence dont le ratio WCAG est connu à
 *  l'avance et vérifiable à la main — avant de faire confiance à `contraste-jetons.spec.ts`, qui
 *  s'appuie dessus pour juger les vrais jetons du produit. Un moteur de calcul qui ne peut pas être
 *  mis en défaut sur du noir/blanc ne prouve rien sur des jetons violets. */
describe('ratioContraste', () => {
  it('noir sur blanc = 21:1 — le maximum théorique WCAG', () => {
    const noir = analyserHsl('0 0% 0%');
    const blanc = analyserHsl('0 0% 100%');
    expect(ratioContraste(noir, blanc)).toBe(21);
  });

  it('une couleur sur elle-même = 1:1 — le minimum théorique', () => {
    const gris = analyserHsl('240 10% 50%');
    expect(ratioContraste(gris, gris)).toBe(1);
  });

  it('est symétrique : l’ordre des deux couleurs ne change pas le résultat', () => {
    const a = analyserHsl('288 58% 36%');
    const b = analyserHsl('0 0% 100%');
    expect(ratioContraste(a, b)).toBe(ratioContraste(b, a));
  });

  it('gris moyen 50% (#808080) sur blanc = 3.95:1 — valeur de référence connue (WebAIM Contrast Checker)', () => {
    const gris50 = analyserHsl('0 0% 50%');
    const blanc = analyserHsl('0 0% 100%');
    // Référence croisée indépendante : WebAIM Contrast Checker donne 3.95:1 pour #808080 sur
    // #ffffff, même formule WCAG 2.1 — confirme que l'arrondi 8 bits de `hslVersRgb` correspond
    // bien à un rendu réel (#808080), pas à une valeur fractionnaire (127.5) jamais affichée.
    expect(ratioContraste(gris50, blanc)).toBe(3.95);
  });
});

describe('hslVersRgb', () => {
  it('convertit correctement les trois primaires', () => {
    expect(hslVersRgb(analyserHsl('0 100% 50%'))).toEqual({ r: 255, g: 0, b: 0 });
    expect(hslVersRgb(analyserHsl('120 100% 50%'))).toEqual({ r: 0, g: 255, b: 0 });
    expect(hslVersRgb(analyserHsl('240 100% 50%'))).toEqual({ r: 0, g: 0, b: 255 });
  });
});

describe('analyserHsl', () => {
  it('rejette une valeur qui n’est pas un triplet HSL — jamais un NaN silencieux', () => {
    expect(() => analyserHsl('var(--autre-jeton)')).toThrow(/Valeur HSL inattendue/);
    expect(() => analyserHsl('')).toThrow(/Valeur HSL inattendue/);
  });
});
