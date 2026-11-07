import { describe, expect, it } from 'vitest';

import {
  GRILLE_VIDE,
  IDS_PREREGLAGE,
  PREREGLAGES,
  capacitesDeLaGrille,
  depassementsDeGrille,
  droitsBaissent,
  grillesEgales,
  incoherencesDeGrille,
  prereglageCorrespondant,
  schemaModificationCapacites,
} from './capacites';

describe('préréglages', () => {
  it('chaque préréglage est cohérent et son rôle d’origine est un rôle de personne', () => {
    for (const id of IDS_PREREGLAGE) {
      expect(incoherencesDeGrille(PREREGLAGES[id].grille), id).toEqual([]);
      expect(PREREGLAGES[id].roleOrigine).not.toBe('poste_atelier');
    }
  });

  it('seule direction est patron ; patron implique gérer les employés', () => {
    const patrons = IDS_PREREGLAGE.filter((id) => PREREGLAGES[id].grille.patron);
    expect(patrons).toEqual(['direction']);
    expect(PREREGLAGES.admin.grille.gererEmployes).toBe(true);
    expect(PREREGLAGES.admin.grille.patron).toBe(false);
  });

  it('fiduciaire est reconnue pour un comptable, le comptable pour lui-même, rien pour un vendeur', () => {
    expect(prereglageCorrespondant('comptable', PREREGLAGES.fiduciaire.grille)).toBe('fiduciaire');
    expect(prereglageCorrespondant('comptable', PREREGLAGES.comptable.grille)).toBe('comptable');
    expect(prereglageCorrespondant('vendeur', PREREGLAGES.fiduciaire.grille)).toBeNull();
  });

  it('fiduciaire : aucune capacité d’écriture (.faire) ni encadrer', () => {
    const c = [...capacitesDeLaGrille(PREREGLAGES.fiduciaire.grille)];
    expect(c.filter((x) => x.endsWith('.faire'))).toEqual([]);
    expect(c).not.toContain('encadrer');
    expect(c).toContain('facturation.montants');
  });
});

describe('gouvernance de grille', () => {
  it('on ne coche pas ce qu’on n’a pas (niveau, encadrer, option)', () => {
    const technicien = PREREGLAGES.technicien.grille;
    const vise = PREREGLAGES.chef_atelier.grille;
    expect(depassementsDeGrille(technicien, vise)).toEqual(
      expect.arrayContaining(['niveaux.pieces', 'encadrer', 'options.voitMontants']),
    );
    expect(depassementsDeGrille(PREREGLAGES.direction.grille, vise)).toEqual([]);
  });

  it('lever le plafond d’avoir pour autrui alors qu’on est plafonné est un dépassement', () => {
    const plafonne = PREREGLAGES.receptionnaire.grille;
    const sansPlafond = { ...plafonne, options: { ...plafonne.options, avoirsPlafonnes: false } };
    expect(depassementsDeGrille(plafonne, sansPlafond)).toContain('options.avoirsPlafonnes');
    expect(depassementsDeGrille(sansPlafond, plafonne)).toEqual([]);
  });

  it('droitsBaissent : retirer une capacité ou une option de visibilité, ou plafonner', () => {
    const d = PREREGLAGES.direction.grille;
    expect(droitsBaissent(d, { ...d, niveaux: { ...d.niveaux, ventes: 'voir' } })).toBe(true);
    expect(droitsBaissent(d, { ...d, options: { ...d.options, voitPrixAchat: false } })).toBe(true);
    expect(droitsBaissent(d, { ...d, options: { ...d.options, avoirsPlafonnes: true } })).toBe(
      true,
    );
    expect(droitsBaissent(PREREGLAGES.technicien.grille, d)).toBe(false);
    expect(droitsBaissent(d, d)).toBe(false);
  });

  it('incohérence : sans « voit les montants », ni Facturation : Faire, ni Ventes : Faire, ni Finances', () => {
    const g = {
      ...PREREGLAGES.direction.grille,
      options: { ...PREREGLAGES.direction.grille.options, voitMontants: false },
    };
    expect(incoherencesDeGrille(g)).toEqual([
      'niveaux.facturation',
      'niveaux.ventes',
      'niveaux.finances',
    ]);
  });

  it('grillesEgales est structurelle', () => {
    expect(grillesEgales(GRILLE_VIDE, { ...GRILLE_VIDE })).toBe(true);
    expect(grillesEgales(GRILLE_VIDE, PREREGLAGES.direction.grille)).toBe(false);
  });
});

describe('schemaModificationCapacites', () => {
  it('accepte une modification partielle, refuse les cases réservées, les inconnues et le vide', () => {
    expect(schemaModificationCapacites.safeParse({ niveaux: { pieces: 'faire' } }).success).toBe(
      true,
    );
    expect(
      schemaModificationCapacites.safeParse({ options: { voitMontants: false } }).success,
    ).toBe(true);
    expect(schemaModificationCapacites.safeParse({ niveaux: { pieces: 'tout' } }).success).toBe(
      false,
    );
    expect(schemaModificationCapacites.safeParse({ niveaux: { garage: 'faire' } }).success).toBe(
      false,
    );
    expect(schemaModificationCapacites.safeParse({ niveaux: {} }).success).toBe(false);
    expect(schemaModificationCapacites.safeParse({ patron: true }).success).toBe(false);
  });
});
