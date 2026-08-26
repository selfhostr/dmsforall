import { expect, test } from '@playwright/test';

import { analyserAccessibilite } from '../support/accessibilite';
import { forcerThemeAvantChargement } from '../support/theme';

/**
 * Contrôle axe-core (WCAG 2.0/2.1 A+AA) sur les six écrans de la barre latérale, dans les deux
 * modes — objectif WCAG AA (CONTRIBUTING.md, skill `web-design-guidelines`). Ne corrige RIEN
 * (`apps/web/src` hors périmètre de cet outillage) : ce fichier prouve et rapporte, le rapport
 * HTML Playwright porte le détail complet en pièce jointe par écran/mode
 * (`axe-<écran>-<mode>.json`) même quand le test passe.
 */
const ECRANS = [
  { id: 'tableau-bord', url: '/tableau-bord', titre: 'Tableau de bord' },
  { id: 'ordres-reparation', url: '/ordres-reparation', titre: 'Ordres de réparation' },
  { id: 'clients', url: '/clients', titre: 'Clients' },
  { id: 'pieces-comptoir', url: '/pieces/recherche-comptoir', titre: 'Recherche comptoir' },
  { id: 'factures', url: '/factures', titre: 'Factures' },
  { id: 'ventes-dossiers', url: '/ventes/dossiers', titre: 'Dossiers de vente' },
] as const;

const MODES = ['light', 'dark'] as const;

for (const ecran of ECRANS) {
  for (const mode of MODES) {
    test(`a11y (WCAG AA) — ${ecran.id} — ${mode}`, async ({ page }) => {
      await forcerThemeAvantChargement(page, mode);
      await page.goto(ecran.url);
      await expect(page.getByRole('heading', { level: 1, name: ecran.titre })).toBeVisible();
      await expect(page.locator('html')).toHaveClass(mode);

      const { violations, resume } = await analyserAccessibilite(
        page,
        test.info(),
        `${ecran.id}-${mode}`,
      );
      expect(violations, `Violations WCAG AA sur ${ecran.id} (${mode}) :\n${resume}`).toEqual([]);
    });
  }
}
