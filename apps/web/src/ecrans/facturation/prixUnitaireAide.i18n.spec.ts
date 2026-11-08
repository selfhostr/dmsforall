import { describe, expect, it } from 'vitest';

import i18n from '@/i18n';

describe('prixUnitaireAide — interpolation ICU (recette #64)', () => {
  it.each(['fr', 'de', 'it'])(
    "%s : le montant HT est injecté, aucune accolade n'est affichée",
    async (langue) => {
      await i18n.changeLanguage(langue);
      const texte = i18n.t('facturation:fiche.lignes.champs.prixUnitaireAide', { ht: "1'000.00" });
      expect(texte).toContain("1'000.00");
      expect(texte).not.toMatch(/[{}]/);
    },
  );
});
