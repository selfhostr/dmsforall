// Tests purs (aucune image, aucun réseau) — exécutables via `node --test` (voir package.json,
// hors du pnpm workspace principal donc hors vitest, voir extraction-permis.spec.ts côté API pour
// l'équivalent des fonctions pures de découpe/validation).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  elargirEtBornerBoite,
  fractionVersPixels,
  MARGE_LARGEUR_DEFAUT,
  MARGE_HAUTEUR_DEFAUT,
} from './geometrie.mjs';

describe('fractionVersPixels', () => {
  it('convertit une boîte fraction en pixels sur les dimensions données', () => {
    const resultat = fractionVersPixels(
      { left: 0.25, top: 0.5, width: 0.1, height: 0.2 },
      1000,
      2000,
    );
    assert.deepEqual(resultat, { left: 250, top: 1000, width: 100, height: 400 });
  });
});

describe('elargirEtBornerBoite', () => {
  it('élargit la boîte proportionnellement à sa taille (marge par défaut)', () => {
    const boite = { left: 100, top: 100, width: 200, height: 100 };
    const resultat = elargirEtBornerBoite(boite, 1000, 1000);

    const margeX = 200 * MARGE_LARGEUR_DEFAUT;
    const margeY = 100 * MARGE_HAUTEUR_DEFAUT;
    assert.equal(resultat.left, Math.round(100 - margeX));
    assert.equal(resultat.top, Math.round(100 - margeY));
    assert.equal(resultat.width, Math.round(200 + margeX * 2));
    assert.equal(resultat.height, Math.round(100 + margeY * 2));
  });

  it('ne déborde jamais de la page même si la boîte touche déjà un bord', () => {
    const boite = { left: 0, top: 0, width: 100, height: 100 };
    const resultat = elargirEtBornerBoite(boite, 1000, 1000);
    assert.equal(resultat.left, 0);
    assert.equal(resultat.top, 0);
  });

  it('ne déborde jamais à droite/en bas', () => {
    const boite = { left: 900, top: 900, width: 100, height: 100 };
    const resultat = elargirEtBornerBoite(boite, 1000, 1000);
    assert.ok(resultat.left + resultat.width <= 1000);
    assert.ok(resultat.top + resultat.height <= 1000);
  });

  it('marge personnalisée : la boîte élargie à 0 marge est identique à la boîte source (bornage exclu)', () => {
    const boite = { left: 100, top: 100, width: 200, height: 100 };
    const resultat = elargirEtBornerBoite(boite, 1000, 1000, { margeLargeur: 0, margeHauteur: 0 });
    assert.deepEqual(resultat, boite);
  });

  it('la boîte élargie contient toujours strictement la boîte source (jamais un caractère de bord perdu par la marge elle-même)', () => {
    const boite = { left: 300, top: 300, width: 150, height: 60 };
    const resultat = elargirEtBornerBoite(boite, 2000, 2000);
    assert.ok(resultat.left <= boite.left);
    assert.ok(resultat.top <= boite.top);
    assert.ok(resultat.left + resultat.width >= boite.left + boite.width);
    assert.ok(resultat.top + resultat.height >= boite.top + boite.height);
  });
});
