import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  analyserHsl,
  ratioContraste,
  SEUIL_AA_COMPOSANT_UI,
  SEUIL_AA_TEXTE_NORMAL,
} from '@/test/accessibilite/contraste';
import { type Theme, valeurHslJeton } from '@/test/accessibilite/jetons-css';

import { Plaque } from './Plaque';

/** Même méthode que `contraste-jetons.spec.ts` (calcul direct sur les valeurs HSL de
 *  `index.css`, seule mesure de contraste possible en jsdom — voir l'en-tête de `contraste.ts`).
 *  Ici, spécifiquement les jetons réellement composés par `Plaque` (`bg-card` / `border-input` /
 *  `text-foreground` / prefixe canton `text-muted-foreground`), pas les jetons génériques déjà
 *  couverts ailleurs — cette carte de couleurs est propre à la signature visuelle de ce
 *  composant (voir le commentaire de tête de `variantesPlaque` dans `Plaque.tsx`). */
function ratio(nomA: string, nomB: string, theme: Theme): number {
  return ratioContraste(
    analyserHsl(valeurHslJeton(nomA, theme)),
    analyserHsl(valeurHslJeton(nomB, theme)),
  );
}

const THEMES: readonly Theme[] = ['clair', 'sombre'];

describe('Plaque', () => {
  it('distingue visuellement le canton déjà présent dans le numéro, sans le doubler', () => {
    // `numero` reflète la forme réelle envoyée par le serveur (`VehiculeResume.plaque` /
    // `ReponseVehiculePlaque.valeur`) : le canton y figure déjà en préfixe.
    render(<Plaque canton="VD" numero="VD 123456" />);
    expect(screen.getByText('VD')).toBeInTheDocument();
    expect(screen.getByText('123456')).toBeInTheDocument();
    expect(screen.queryByText('VD 123456')).not.toBeInTheDocument();
    expect(screen.queryByText('VD VD 123456')).not.toBeInTheDocument();
  });

  it('ne double jamais le canton (régression) : "VS 123456" reste "VS 123456"', () => {
    render(<Plaque canton="VS" numero="VS 123456" />);
    expect(screen.queryByText('VS VS 123456')).not.toBeInTheDocument();
    expect(screen.getByText('VS')).toBeInTheDocument();
    expect(screen.getByText('123456')).toBeInTheDocument();
    // Reconstitue le texte affiché à partir des deux fragments stylés séparément.
    const conteneur = screen.getByText('123456').parentElement;
    expect(conteneur?.textContent).toBe('VS123456');
  });

  it('rend le numéro seul quand le canton est inconnu (plaque étrangère)', () => {
    render(<Plaque canton={null} numero="AB123CD" />);
    expect(screen.getByText('AB123CD')).toBeInTheDocument();
    expect(screen.queryByText('null')).not.toBeInTheDocument();
  });

  it('rend le numéro tel quel si le canton fourni ne préfixe pas la valeur (défensif)', () => {
    render(<Plaque canton="VD" numero="AB123CD" />);
    expect(screen.getByText('AB123CD')).toBeInTheDocument();
    expect(screen.queryByText('VD')).not.toBeInTheDocument();
  });

  it('rend un tiret neutre quand le véhicule ne porte aucune plaque', () => {
    render(<Plaque canton={null} numero={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('pose le fond Alu dédié, le filet appuyé et le mono identifiant — pas le badge générique', () => {
    render(<Plaque canton="VD" numero="VD 123456" />);
    const conteneur = screen.getByText('123456').parentElement;
    // `bg-card` (surface dédiée), pas `bg-muted`/`bg-secondary`/`bg-accent` (gris générique
    // partagé par tout le reste du produit — voir le commentaire de tête de `variantesPlaque`).
    expect(conteneur?.className).toContain('bg-card');
    expect(conteneur?.className).not.toContain('bg-muted');
    // Filet appuyé : `border-2`, pas le `border` (1px) générique.
    expect(conteneur?.className).toMatch(/\bborder-2\b/);
    expect(conteneur?.className).toContain('border-input');
    // Plex Mono via l'utilitaire dédié à cette famille d'identifiants, poids 600 séparé.
    expect(conteneur?.className).toContain('texte-identifiant');
    expect(conteneur?.className).toContain('font-semibold');
  });

  describe.each(THEMES)('contraste réel des jetons composés par Plaque (%s)', (theme) => {
    it(`texte (--foreground) sur le fond Alu (--card) atteint ${SEUIL_AA_TEXTE_NORMAL}:1`, () => {
      expect(ratio('foreground', 'card', theme)).toBeGreaterThanOrEqual(SEUIL_AA_TEXTE_NORMAL);
    });

    it(`préfixe canton (--muted-foreground) sur --card atteint ${SEUIL_AA_TEXTE_NORMAL}:1`, () => {
      expect(ratio('muted-foreground', 'card', theme)).toBeGreaterThanOrEqual(
        SEUIL_AA_TEXTE_NORMAL,
      );
    });

    it(`filet (--input) sur --card atteint ${SEUIL_AA_COMPOSANT_UI}:1 (WCAG 1.4.11)`, () => {
      expect(ratio('input', 'card', theme)).toBeGreaterThanOrEqual(SEUIL_AA_COMPOSANT_UI);
    });
  });
});
