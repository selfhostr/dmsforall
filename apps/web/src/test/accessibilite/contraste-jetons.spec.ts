import { describe, expect, it } from 'vitest';

import {
  analyserHsl,
  ratioContraste,
  SEUIL_AA_COMPOSANT_UI,
  SEUIL_AA_TEXTE_NORMAL,
} from './contraste';
import { valeurHslJeton } from './jetons-css';

/**
 * Verdict chiffré et EXÉCUTABLE sur les jetons de couleur du Lot K (`src/index.css`), seule mesure
 * de contraste possible dans ce dépôt — voir l'en-tête de `contraste.ts` pour pourquoi axe-core/
 * jsdom ne peuvent pas s'en charger. Les paires ci-dessous et leurs seuils reprennent exactement la
 * méthode déjà documentée « à la main » dans `docs/design-comptoir.md` (tableau « Contraste mesuré
 * — statuts ») et les commentaires de `index.css` (`--destructive`, `--input`, `--avertissement`…) :
 * ce fichier la rend vérifiable à chaque exécution de `pnpm test`, plutôt que vraie seulement au
 * jour où quelqu'un l'a calculée à la main.
 *
 * Portée assumée : ceci vérifie les JETONS eux-mêmes (les valeurs HSL déclarées), pas qu'un
 * composant donné les applique à pleine opacité — un `bg-statut-info/10` (fond éclairci par une
 * classe d'opacité Tailwind, vu dans `DialogueCorrectionFacture.tsx`) change le ratio réel et
 * N'EST PAS mesuré ici. Un jeton faux se répare une fois ; un mésusage d'opacité se répare par
 * écran, hors périmètre de ce fichier.
 */

function ratio(nomA: string, nomB: string): number {
  return ratioContraste(analyserHsl(valeurHslJeton(nomA)), analyserHsl(valeurHslJeton(nomB)));
}

describe('jetons de base — texte sur fond, seuil AA texte normal (4.5:1)', () => {
  const paires: ReadonlyArray<readonly [string, string, string]> = [
    ['foreground', 'background', 'texte principal sur fond de page'],
    ['card-foreground', 'card', 'texte sur une carte'],
    ['popover-foreground', 'popover', 'texte dans un popover/menu'],
    ['muted-foreground', 'background', 'texte atténué sur fond de page'],
    [
      'muted-foreground',
      'muted',
      'texte atténué sur fond atténué (.texte-libelle en zone secondaire)',
    ],
    ['primary-foreground', 'primary', 'texte sur un bouton plein (couleur de marque)'],
    ['secondary-foreground', 'secondary', 'texte sur un bouton secondaire'],
    ['accent-foreground', 'accent', 'texte sur une surface de survol'],
    ['destructive-foreground', 'destructive', 'texte blanc sur un bouton « Supprimer »'],
    [
      'marque-doux-foreground',
      'marque-doux',
      'texte sur surlignage de marque (élément de menu actif)',
    ],
  ];

  it.each(paires)('%s sur %s (%s) atteint 4.5:1', (nomA, nomB) => {
    expect(ratio(nomA, nomB)).toBeGreaterThanOrEqual(SEUIL_AA_TEXTE_NORMAL);
  });
});

describe('statuts — six tokens, trois usages chacun (docs/design-comptoir.md)', () => {
  const statuts = [
    'statut-neutre',
    'statut-info',
    'statut-attention',
    'statut-succes',
    'statut-danger',
    'statut-terminal',
  ];

  it.each(statuts)('%s sur background atteint 4.5:1 (badge « contour »)', (statut) => {
    expect(ratio(statut, 'background')).toBeGreaterThanOrEqual(SEUIL_AA_TEXTE_NORMAL);
  });

  it.each(statuts)(
    '%s sur muted atteint 4.5:1 (badge « contour » en zone secondaire)',
    (statut) => {
      expect(ratio(statut, 'muted')).toBeGreaterThanOrEqual(SEUIL_AA_TEXTE_NORMAL);
    },
  );

  it.each(statuts)('blanc sur %s (fond plein) atteint 4.5:1 (badge « plein »)', (statut) => {
    expect(ratio('primary-foreground', statut)).toBeGreaterThanOrEqual(SEUIL_AA_TEXTE_NORMAL);
  });

  // Sentinelles : ces deux tokens ont été explicitement assombris au Lot K pour franchir le seuil
  // (voir commentaire `index.css` au-dessus de `--statut-neutre`/`--statut-attention`). S'ils
  // remontent un jour vers leur ancienne luminosité (46 %/34 %), ce test précis doit rougir.
  it('statut-neutre reste sous 46 % de luminosité (régression connue : 46 % échouait à 4.42:1 sur muted)', () => {
    expect(analyserHsl(valeurHslJeton('statut-neutre')).l).toBeLessThanOrEqual(44);
  });

  it('statut-attention reste sous 34 % de luminosité (régression connue : 34 % échouait à 3.93:1)', () => {
    expect(analyserHsl(valeurHslJeton('statut-attention')).l).toBeLessThanOrEqual(30);
  });
});

describe('composants non textuels — seuil AA 3:1 (WCAG 1.4.11, contours de contrôle)', () => {
  it('input (contour de champ/case à cocher) sur background atteint 3:1', () => {
    expect(ratio('input', 'background')).toBeGreaterThanOrEqual(SEUIL_AA_COMPOSANT_UI);
  });

  it('input sur muted atteint 3:1', () => {
    expect(ratio('input', 'muted')).toBeGreaterThanOrEqual(SEUIL_AA_COMPOSANT_UI);
  });

  it('ring (anneau de focus) sur background atteint 3:1', () => {
    expect(ratio('ring', 'background')).toBeGreaterThanOrEqual(SEUIL_AA_COMPOSANT_UI);
  });

  it('avertissement-bordure sur background atteint 3:1', () => {
    expect(ratio('avertissement-bordure', 'background')).toBeGreaterThanOrEqual(
      SEUIL_AA_COMPOSANT_UI,
    );
  });

  // `--border` est un trait DÉCORATIF (séparateur, filet de tableau) — explicitement exempté du
  // seuil 3:1 par le commentaire `index.css` juste au-dessus de sa déclaration. On ne l'assertit
  // donc PAS contre 3:1 (ce serait affaiblir le test en visant une cible qui ne s'applique pas) ;
  // on documente seulement qu'il reste sous ce seuil, pour qu'un futur usage erroné de `--border`
  // comme contour de contrôle (au lieu de `--input`) se voie dans ce test s'il change de valeur.
  it('border (décoratif, EXEMPTÉ de 3:1) — ratio documenté, pas une porte de conformité', () => {
    expect(ratio('border', 'background')).toBeCloseTo(1.4, 1);
  });
});

describe('famille avertissement (bandeaux/encarts — distincte des statuts et de la marque)', () => {
  it('avertissement sur avertissement-fond atteint 4.5:1', () => {
    expect(ratio('avertissement', 'avertissement-fond')).toBeGreaterThanOrEqual(
      SEUIL_AA_TEXTE_NORMAL,
    );
  });
});
