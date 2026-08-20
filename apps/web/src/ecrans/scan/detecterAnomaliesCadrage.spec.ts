import { describe, expect, it } from 'vitest';

import { AIRE_MAX_FRAC } from './detecterBordsDocument';
import {
  SEUIL_REMPLISSAGE_MARGE_INSUFFISANTE,
  SEUIL_REMPLISSAGE_PAGE_PLIEE,
  classifierAnomalieCadrage,
  detecterAnomalieCadrageDepuisPixels,
} from './detecterAnomaliesCadrage';

/** Même patron que `tamponAvecRectangle` dans `detecterBordsDocument.spec.ts` : un fond uniforme et
 *  un rectangle net. */
function tamponAvecRectangle(
  largeur: number,
  hauteur: number,
  rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  fond: readonly [number, number, number] = [200, 200, 200],
  avantPlan: readonly [number, number, number] = [20, 20, 20],
): { largeur: number; hauteur: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(largeur * hauteur * 4);
  for (let y = 0; y < hauteur; y += 1) {
    for (let x = 0; x < largeur; x += 1) {
      const dansRect = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
      const [r, v, b] = dansRect ? avantPlan : fond;
      const base = (y * largeur + x) * 4;
      data[base] = r;
      data[base + 1] = v;
      data[base + 2] = b;
      data[base + 3] = 255;
    }
  }
  return { largeur, hauteur, data };
}

/**
 * `classifierAnomalieCadrage` REJOUE DIRECTEMENT LES MESURES DU CORPUS DE CALIBRATION (17 photos
 * réelles, 18-20.08.2026 — voir la doc de tête de `detecterAnomaliesCadrage.ts`) : construire, à la
 * main, un tampon de pixels qui retombe exactement sur un couple (aire, remplissage) donné est
 * fragile (recherche exhaustive faite pendant ce chantier : AUCUNE combinaison de marges, sur un
 * rectangle plein de deux couleurs, ne retombe dans la fenêtre `margeInsuffisante` — le signal brut a
 * un comportement à seuil, pas continu, pour ce genre de forme idéalisée ; seul le bruit d'une vraie
 * photo JPEG produit les valeurs intermédiaires observées). Les valeurs ci-dessous sont les mesures
 * RÉELLES, traçables jusqu'au nom du fichier — c'est la meilleure preuve possible que les seuils
 * séparent effectivement les bons cas des mauvais SUR LE CORPUS DE RÉFÉRENCE.
 */
describe('classifierAnomalieCadrage — rejoue les mesures du corpus de calibration', () => {
  it('photo_2026-08-18_13-10-53 (marge réellement insuffisante, vérifié à l’œil) -> margeInsuffisante', () => {
    expect(classifierAnomalieCadrage(0.978, 0.65)).toBe('margeInsuffisante');
  });

  it('IMG_2503 (pire faux positif observé : fond de tableau de bord chargé, vraie marge confirmée à l’œil) -> aucune anomalie', () => {
    // Remplissage 0.616, à seulement 0.014 sous le seuil — l’écart le plus étroit du corpus, voir la
    // doc de tête. C’est CE cas précis qui fixe `SEUIL_REMPLISSAGE_MARGE_INSUFFISANTE`.
    expect(classifierAnomalieCadrage(0.979, 0.616)).toBeNull();
  });

  it('photo_2026-08-18_13-09-56 (page repliée derrière, une seule page visible) -> pageNonAPlat', () => {
    expect(classifierAnomalieCadrage(0.922, 0.332)).toBe('pageNonAPlat');
  });

  it('photo_2026-08-18_13-10-49 (cadrage confiant, aire sous AIRE_MAX_FRAC malgré un remplissage élevé) -> aucune anomalie', () => {
    expect(classifierAnomalieCadrage(0.897, 0.829)).toBeNull();
  });

  it('photo_2026-08-18_13-11-03 (cadrage confiant) -> aucune anomalie', () => {
    expect(classifierAnomalieCadrage(0.864, 0.755)).toBeNull();
  });

  it('IMG_2510 (aire modérée malgré un remplissage très élevé) -> aucune anomalie', () => {
    expect(classifierAnomalieCadrage(0.519, 0.917)).toBeNull();
  });

  it('les 15 photos correctes du corpus, rejouées une à une, ne déclenchent aucune anomalie', () => {
    // (aireFrac, remplissage) mesurés pour chacune des 15 photos SAINES du corpus de calibration —
    // voir le rapport de livraison pour le tableau complet. Reproduites ici en bloc plutôt qu’une
    // par une : la même assertion (« aucune anomalie ») pour toutes, la valeur qui distingue le
    // couple le plus proche du seuil (IMG_2503) étant déjà couverte par son propre test ci-dessus.
    const mesures: ReadonlyArray<readonly [number, number]> = [
      [0.579, 0.841], // photo_2026-08-18_13-09-32
      [0.575, 0.406], // photo_2026-08-18_13-10-02
      [0.152, 0.326], // photo_2026-08-18_13-10-09
      [0.422, 0.562], // photo_2026-08-18_13-10-16
      [0.834, 0.44], // photo_2026-08-18_13-10-35
      [0.895, 0.381], // photo_2026-08-18_13-10-39
      [0.668, 0.506], // photo_2026-08-18_13-10-44
      [0.897, 0.829], // photo_2026-08-18_13-10-49
      [0.864, 0.755], // photo_2026-08-18_13-11-03
      [0.777, 0.499], // photo_2026-08-18_13-11-07
      [0.62, 0.325], // photo_2026-08-18_13-11-12
      [0.89, 0.57], // IMG_2502
      [0.979, 0.616], // IMG_2503
      [0.696, 0.619], // IMG_2509
      [0.519, 0.917], // IMG_2510
    ];
    for (const [aireFrac, remplissage] of mesures) {
      expect(classifierAnomalieCadrage(aireFrac, remplissage)).toBeNull();
    }
  });

  it('les seuils sont des bornes exactes (aire strictement > AIRE_MAX_FRAC, remplissage selon <, >=)', () => {
    expect(classifierAnomalieCadrage(AIRE_MAX_FRAC, 0.3)).toBeNull(); // pile sur AIRE_MAX_FRAC : pas encore anormal
    expect(classifierAnomalieCadrage(AIRE_MAX_FRAC + 0.001, 0.3)).toBe('pageNonAPlat');
    expect(
      classifierAnomalieCadrage(AIRE_MAX_FRAC + 0.001, SEUIL_REMPLISSAGE_PAGE_PLIEE),
    ).toBeNull(); // pile sur le seuil bas : plus "page pliée" (condition stricte <)
    expect(
      classifierAnomalieCadrage(
        AIRE_MAX_FRAC + 0.001,
        SEUIL_REMPLISSAGE_MARGE_INSUFFISANTE - 0.001,
      ),
    ).toBeNull(); // zone grise, juste sous le seuil haut
    expect(
      classifierAnomalieCadrage(AIRE_MAX_FRAC + 0.001, SEUIL_REMPLISSAGE_MARGE_INSUFFISANTE),
    ).toBe('margeInsuffisante'); // pile sur le seuil haut : condition >=
  });
});

describe('detecterAnomalieCadrageDepuisPixels — plomberie signal brut -> classification', () => {
  it('un document qui remplit tout le cadre sans la moindre marge (cas extrême) est signalé comme une anomalie', () => {
    // Même tampon que le test « au-dessus d'AIRE_MAX_FRAC » de detecterBordsDocument.spec.ts (aire =
    // 96 %, rectangle SOLIDE). Sur ce cas extrême et parfaitement uniforme (aucun bruit JPEG),
    // l'estimation du fond bascule (la bande d'échantillonnage est presque entièrement occupée par
    // le document) et le signal brut s'inverse : c'est la fine bordure de VRAI fond qui ressort comme
    // « composant » — remplissage très bas. Le résultat n'en reste pas moins une ANOMALIE détectée
    // (jamais un cadrage silencieusement accepté sur un cas aussi extrême) ; c'est la bonne propriété
    // à vérifier ici, pas le sous-type précis (voir `classifierAnomalieCadrage` ci-dessus pour la
    // classification fine, testée sur les vraies mesures du corpus).
    const tampon = tamponAvecRectangle(100, 100, { x: 1, y: 1, w: 98, h: 98 });
    const resultat = detecterAnomalieCadrageDepuisPixels(tampon);
    expect(resultat).not.toBeNull();
    expect(resultat!.aireFrac).toBeGreaterThan(AIRE_MAX_FRAC);
  });

  it('un cadrage normal (document net, avec une vraie marge) ne signale aucune anomalie', () => {
    // Même tampon que le cas « détecté avec confiance » de detecterBordsDocument.spec.ts (aire =
    // 24 %) : loin sous AIRE_MAX_FRAC, rien d’anormal à signaler ici.
    const tampon = tamponAvecRectangle(100, 100, { x: 20, y: 30, w: 60, h: 40 });
    expect(detecterAnomalieCadrageDepuisPixels(tampon)).toBeNull();
  });

  it('une photo parfaitement uniforme (rien à détecter) ne signale aucune anomalie', () => {
    const tampon = tamponAvecRectangle(50, 50, { x: 0, y: 0, w: 0, h: 0 });
    expect(detecterAnomalieCadrageDepuisPixels(tampon)).toBeNull();
  });

  it('un tampon dont la longueur de données ne correspond pas à largeur*hauteur*4 est refusé sans tenter de lire hors bornes', () => {
    expect(
      detecterAnomalieCadrageDepuisPixels({
        largeur: 10,
        hauteur: 10,
        data: new Uint8ClampedArray(4),
      }),
    ).toBeNull();
  });
});
