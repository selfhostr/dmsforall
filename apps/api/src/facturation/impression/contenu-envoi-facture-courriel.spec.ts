import { describe, expect, it } from 'vitest';

import { construireContenuEnvoiFacture } from './contenu-envoi-facture-courriel';

describe('construireContenuEnvoiFacture', () => {
  it.each(['fr', 'de', 'it'] as const)('produit un sujet et un texte non vides en %s', (langue) => {
    const contenu = construireContenuEnvoiFacture({
      numero: '2026-00042',
      totalTtcCentimes: 123450,
      langue,
    });

    expect(contenu.sujet.length).toBeGreaterThan(0);
    expect(contenu.texte.length).toBeGreaterThan(0);
    expect(contenu.sujet).toContain('2026-00042');
    expect(contenu.texte).toContain('2026-00042');
  });

  it('inclut le montant formaté à la suisse (milliers séparés par une apostrophe) quand connu', () => {
    const contenu = construireContenuEnvoiFacture({
      numero: '2026-00042',
      totalTtcCentimes: 123450,
      langue: 'fr',
    });

    expect(contenu.texte).toContain("1'234.50");
  });

  it('reste correct sans montant (rôle qui ne verrait pas les montants — défensif, ne devrait pas se produire en pratique)', () => {
    const contenu = construireContenuEnvoiFacture({
      numero: '2026-00042',
      totalTtcCentimes: undefined,
      langue: 'fr',
    });

    expect(contenu.texte).not.toContain('CHF');
    expect(contenu.texte).toContain('2026-00042');
  });

  it('le sujet est distinct par langue (jamais un texte français dans un sujet DE/IT)', () => {
    const fr = construireContenuEnvoiFacture({
      numero: 'F-1',
      totalTtcCentimes: 100,
      langue: 'fr',
    });
    const de = construireContenuEnvoiFacture({
      numero: 'F-1',
      totalTtcCentimes: 100,
      langue: 'de',
    });
    const it = construireContenuEnvoiFacture({
      numero: 'F-1',
      totalTtcCentimes: 100,
      langue: 'it',
    });

    expect(new Set([fr.sujet, de.sujet, it.sujet]).size).toBe(3);
  });
});
