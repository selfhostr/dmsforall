/**
 * Calcul de contraste WCAG 2.1 à partir de couleurs HSL — indépendant du DOM.
 *
 * Pourquoi ce fichier existe : axe-core ne peut PAS mesurer le contraste réel dans les tests de ce
 * dépôt. Deux raisons cumulatives, vérifiées en exécution (voir `harnais.ts` et
 * `contraste-jetons.spec.ts`) :
 *   1. `vitest.config.ts` déclare `css: false` — Tailwind n'est jamais injecté en jsdom, donc les
 *      classes `bg-*`/`text-*` d'un composant ne produisent aucune couleur calculée à lire.
 *   2. `jest-axe` désactive lui-même toute la catégorie `cat.color` par défaut (voir son code
 *      source, `AXE_RULES_COLOR` dans `node_modules/jest-axe/index.js`), précisément parce que
 *      jsdom ne calcule pas de styles rendus fiables pour ce genre de règle.
 *
 * La seule mesure honnête possible ici est un calcul direct sur les valeurs HSL déclarées dans
 * `src/index.css`, indépendant du rendu DOM — exactement la méthode déjà utilisée (à la main,
 * script Node ponctuel) pour documenter le tableau « Contraste mesuré » de
 * `docs/design-comptoir.md`. Ce module transforme cette méthode documentée en fonctions
 * exécutables et testées : un commentaire ne peut pas rougir quand quelqu'un change une valeur,
 * un test peut (voir `contraste-jetons.spec.ts`, qui lit `index.css` à chaque exécution).
 */

export interface CouleurHsl {
  readonly h: number;
  readonly s: number;
  readonly l: number;
}

const MOTIF_HSL = /^\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*$/;

/** Convertit `H S% L%` (format des custom properties de `index.css`) en HSL structuré. */
export function analyserHsl(valeur: string): CouleurHsl {
  const correspondance = MOTIF_HSL.exec(valeur);
  if (!correspondance) {
    throw new Error(`Valeur HSL inattendue : « ${valeur} » (format attendu : "H S% L%").`);
  }
  const [, h, s, l] = correspondance;
  return { h: Number(h), s: Number(s), l: Number(l) };
}

interface CouleurRgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** HSL -> sRGB (0-255 par canal). Formule standard, CSS Color Module Level 3. */
export function hslVersRgb({ h, s, l }: CouleurHsl): CouleurRgb {
  const sN = s / 100;
  const lN = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => lN - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  // Arrondi à l'entier 8 bits : un écran ne rend jamais une valeur de canal fractionnaire, et
  // c'est aussi ce que fait un navigateur (`getComputedStyle` renvoie des `rgb()` entiers). Sans
  // cet arrondi, un gris HSL exactement à 50 % de luminosité (127.5) donnerait un ratio différent
  // de celui mesuré par un outil de référence sur le même gris exprimé en hexadécimal (#808080).
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

function canalVersLineaire(canal8bits: number): number {
  const c = canal8bits / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Luminance relative WCAG 2.1 — formule officielle.
 *  https://www.w3.org/TR/WCAG21/#dfn-relative-luminance */
export function luminanceRelative(couleur: CouleurHsl): number {
  const { r, g, b } = hslVersRgb(couleur);
  return (
    0.2126 * canalVersLineaire(r) + 0.7152 * canalVersLineaire(g) + 0.0722 * canalVersLineaire(b)
  );
}

/** Ratio de contraste WCAG 2.1 entre deux couleurs (symétrique), arrondi à 2 décimales — même
 *  arrondi que le tableau de `docs/design-comptoir.md`, pour rester comparable à l'œil. */
export function ratioContraste(a: CouleurHsl, b: CouleurHsl): number {
  const la = luminanceRelative(a);
  const lb = luminanceRelative(b);
  const [clair, sombre] = la >= lb ? [la, lb] : [lb, la];
  return Math.round(((clair + 0.05) / (sombre + 0.05)) * 100) / 100;
}

/** Seuils WCAG 2.1 niveau AA. */
export const SEUIL_AA_TEXTE_NORMAL = 4.5;
export const SEUIL_AA_TEXTE_LARGE = 3;
/** Critère 1.4.11 (Non-text Contrast) : contours de contrôle, indicateurs de focus, icônes
 *  porteuses de sens — pas les traits purement décoratifs. */
export const SEUIL_AA_COMPOSANT_UI = 3;
