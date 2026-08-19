// Test fonctionnel sur image SYNTHÉTIQUE (générée en mémoire par sharp, aucune photo réelle, aucune
// donnée personnelle) — `node --test`, voir geometrie.spec.mjs pour le même patron. Ne couvre que
// `recadrerChamp` (la seule fonction de ce fichier dont le comportement se vérifie sans dépendre de
// Tesseract) : la bordure blanche ajoutée autour de la découpe (voir l'en-tête de `pretraitement.mjs`
// § BORDURE_BLANCHE_PX) et le respect de `largeurCible`.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import sharp from 'sharp';

import { recadrerChamp } from './pretraitement.mjs';

/** Page 200x100 unie, aucun contenu réel — seule la géométrie de sortie est vérifiée ici, jamais un
 *  texte lu (ce module ne fait pas d'OCR). */
async function pageSynthetique() {
  return sharp({
    create: { width: 200, height: 100, channels: 3, background: { r: 128, g: 128, b: 128 } },
  })
    .png()
    .toBuffer();
}

describe('recadrerChamp', () => {
  it('agrandit à largeurCible PUIS ajoute la bordure blanche par défaut de chaque côté', async () => {
    const page = await pageSynthetique();
    const crop = await recadrerChamp(
      page,
      { left: 10, top: 10, width: 100, height: 50 },
      { largeurCible: 400 },
    );
    const metadonnees = await sharp(crop).metadata();
    // 400 (largeurCible) + 20px de bordure de chaque côté (défaut) = 440. Hauteur : ratio conservé
    // par resize (400/100 = x4 -> 50*4=200) + 40 de bordure = 240.
    assert.equal(metadonnees.width, 440);
    assert.equal(metadonnees.height, 240);
  });

  it('bordure personnalisable (bordurePx) : une bordure nulle ne change que la taille attendue', async () => {
    const page = await pageSynthetique();
    const crop = await recadrerChamp(
      page,
      { left: 10, top: 10, width: 100, height: 50 },
      { largeurCible: 400, bordurePx: 0 },
    );
    const metadonnees = await sharp(crop).metadata();
    assert.equal(metadonnees.width, 400);
    assert.equal(metadonnees.height, 200);
  });

  it('la bordure ajoutée est un blanc pur (255) sur les quatre bords, pas la couleur de fond de la page', async () => {
    const page = await pageSynthetique();
    const crop = await recadrerChamp(
      page,
      { left: 10, top: 10, width: 100, height: 50 },
      { largeurCible: 400, bordurePx: 20 },
    );
    const { data, info } = await sharp(crop).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x, y) => data[(y * info.width + x) * info.channels];
    // Coin haut-gauche (0,0) et coin bas-droit sont dans la bordure ajoutée, jamais dans le contenu
    // recadré/binarisé (`threshold(150)` produit du 0 ou 255 pur, la bordure doit matcher le blanc).
    assert.equal(pixel(0, 0), 255);
    assert.equal(pixel(info.width - 1, info.height - 1), 255);
  });
});
