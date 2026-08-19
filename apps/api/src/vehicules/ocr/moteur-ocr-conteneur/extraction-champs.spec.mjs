// Tests purs (aucune image, aucun réseau) — `node --test`, voir geometrie.spec.mjs pour le même
// patron. `calculerLargeurCibleChamp` est la seule partie testable sans Tesseract/sharp réels de ce
// fichier — le reste (`extraireChampsPermis`) orchestre des appels réseau/CPU réels, hors périmètre
// d'un test unitaire (voir `outillage-mesure.mjs` pour la mesure sur corpus réel).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculerLargeurCibleChamp,
  FACTEUR_AGRANDISSEMENT_CIBLE,
  LARGEUR_CROP_MAX,
  LARGEUR_CROP_MIN,
} from './extraction-champs.mjs';

describe('calculerLargeurCibleChamp', () => {
  it('applique le facteur documenté (3.5x) sur une largeur de boîte dans la plage normale', () => {
    assert.equal(calculerLargeurCibleChamp(500), Math.round(500 * FACTEUR_AGRANDISSEMENT_CIBLE));
  });

  it('borne en bas : une découpe minuscule ne descend jamais sous LARGEUR_CROP_MIN', () => {
    assert.equal(calculerLargeurCibleChamp(10), LARGEUR_CROP_MIN);
  });

  it('borne en haut : une découpe déjà large (zone nom/adresse) ne dépasse jamais LARGEUR_CROP_MAX', () => {
    assert.equal(calculerLargeurCibleChamp(2000), LARGEUR_CROP_MAX);
  });

  it('rend toujours un entier (sharp.resize rejette une largeur non entière)', () => {
    assert.equal(Number.isInteger(calculerLargeurCibleChamp(437)), true);
  });
});
