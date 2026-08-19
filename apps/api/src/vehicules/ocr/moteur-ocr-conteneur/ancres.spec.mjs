import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  boiteValeurFraction,
  localiserAncres,
  normaliserBboxFraction,
  normaliserMot,
} from './ancres.mjs';

describe('normaliserMot', () => {
  it('minuscule, sans accent, lettres seulement', () => {
    assert.equal(normaliserMot('Châssis-No.'), 'chassisno');
  });

  it('texte vide/absent -> chaîne vide', () => {
    assert.equal(normaliserMot(''), '');
    assert.equal(normaliserMot(undefined), '');
  });
});

describe('normaliserBboxFraction', () => {
  it('bbox pixel -> fraction de page', () => {
    const resultat = normaliserBboxFraction({ x0: 100, x1: 300, y0: 50, y1: 100 }, 1000, 500);
    assert.deepEqual(resultat, { x0: 0.1, x1: 0.3, y0: 0.1, y1: 0.2 });
  });
});

describe('boiteValeurFraction', () => {
  it('champ en ligne (vin) : left relatif à x1 de l’ancre (+ marge), top CENTRÉ sur sa bbox', () => {
    const ancre = { x0: 0.05, x1: 0.2, y0: 0.3, y1: 0.32 };
    const boite = boiteValeurFraction('vin', ancre);
    assert.ok(Math.abs(boite.left - (0.2 + 0.01)) < 1e-9); // x1 + MARGE_APRES_LIBELLE
    assert.ok(Math.abs(boite.top - ((0.3 + 0.32) / 2 - 0.065 / 2)) < 1e-9);
  });

  // Régression du bug corrigé le 18.08 : sans `hauteurEstCelleDeLaLigne` sur l'entrée
  // GEOMETRIE_VALEUR d'un champ en ligne, `top` retombait sur l'ancre du bord haut de la ligne
  // matchée au lieu d'être centré sur sa bbox — invisible quand la ligne matchée était la
  // première de l'empilement fr/de/it/rm (top identique dans les deux cas), donc jamais détecté
  // sans une ancre matchée plus bas dans l'empilement. Cas ci-dessous : ancre haute et fine (une
  // seule ligne matchée, pas la première) — un calcul non centré donnerait un `top` bien plus
  // proche de `ancre.y0` que du milieu de la bbox.
  for (const champ of ['vin', 'codeTypeCh', 'plaque', 'premiereMiseEnCirculationLe']) {
    it(`${champ} : top centré (pas aligné sur le bord haut de l’ancre)`, () => {
      const ancre = { x0: 0.1, x1: 0.25, y0: 0.5, y1: 0.508 };
      const boite = boiteValeurFraction(champ, ancre);
      const milieu = (ancre.y0 + ancre.y1) / 2;
      // Centré : distance top<->milieu ~ hauteur/2, jamais top ~= y0 (bord haut, comportement du
      // bug : top = y0 - hauteur*0.15).
      assert.ok(Math.abs(boite.top - ancre.y0) > 1e-6, 'top ne doit pas coller au bord haut');
      assert.ok(boite.top < milieu, 'top doit rester au-dessus du milieu (bbox centrée dessus)');
    });
  }

  it('champ nom : left dépend de x1 de l’ancre, top non centré (suit le bord haut avec une marge réduite)', () => {
    const ancre = { x0: 0.55, x1: 0.7, y0: 0.3, y1: 0.32 };
    const boite = boiteValeurFraction('detenteurNom', ancre);
    assert.ok(Math.abs(boite.left - (0.7 + 0.01)) < 1e-9); // x1 + MARGE_APRES_LIBELLE
    assert.ok(Math.abs(boite.top - (0.3 - 0.05 * 0.15)) < 1e-9);
  });

  it('champ adresse : top part du BAS du libellé matché (depuisBasLibelle)', () => {
    const ancre = { x0: 0.55, x1: 0.7, y0: 0.3, y1: 0.32 };
    const boite = boiteValeurFraction('detenteurAdresse', ancre);
    assert.ok(Math.abs(boite.top - 0.32) < 1e-9);
  });

  it('left/top jamais négatifs en sortie (clampés à 0, le clamp haut/bord reste à la charge de l’appelant)', () => {
    const ancre = { x0: 0, x1: 0.005, y0: 0, y1: 0.005 };
    const boite = boiteValeurFraction('detenteurNom', ancre);
    assert.ok(boite.left >= 0);
    assert.ok(boite.top >= 0);
  });
});

describe('localiserAncres', () => {
  it('mot qui contient une variante -> localisé', () => {
    const mots = [{ text: 'Chassis-No.', bbox: { x0: 0, x1: 1, y0: 0, y1: 1 }, confidence: 90 }];
    const resultat = localiserAncres(mots);
    assert.ok(resultat.vin);
    assert.equal(resultat.vin.confiance, 90);
  });

  it('aucun mot ne correspond -> null pour ce champ', () => {
    const resultat = localiserAncres([{ text: 'bonjour', bbox: {}, confidence: 90 }]);
    assert.equal(resultat.vin, null);
  });

  it('plusieurs correspondances -> garde la plus confiante', () => {
    const mots = [
      { text: 'Chassis', bbox: { id: 1 }, confidence: 50 },
      { text: 'Fahrgestellnr', bbox: { id: 2 }, confidence: 95 },
    ];
    const resultat = localiserAncres(mots);
    assert.equal(resultat.vin.confiance, 95);
  });

  it("« type », sous-mot court de l'ancre codeTypeCh -> ignoré (collision mesurée, voir commentaire)", () => {
    const mots = [{ text: 'type', bbox: {}, confidence: 90 }];
    const resultat = localiserAncres(mots);
    assert.equal(resultat.codeTypeCh, null);
  });
});
