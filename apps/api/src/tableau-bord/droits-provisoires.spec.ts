import { describe, expect, it } from 'vitest';
import { ROLES_UTILISATEUR, type RoleUtilisateur } from '@dfa/shared';

import { ErreurMetier } from '../common/erreurs';

import {
  ROLES_TABLEAU_BORD_ACTIVITE,
  ROLES_TABLEAU_BORD_FINANCIER,
  verifierRoleAutorise,
} from './droits-provisoires';

describe('ROLES_TABLEAU_BORD_ACTIVITE — large, SEUL poste_atelier exclu (borne murale)', () => {
  it('exactement les 8 rôles de personne, poste_atelier exclu', () => {
    const attendus = ROLES_UTILISATEUR.filter((role) => role !== 'poste_atelier');
    expect([...ROLES_TABLEAU_BORD_ACTIVITE].sort()).toEqual([...attendus].sort());
  });

  it('poste_atelier explicitement exclu — aucun montant, mais aucune synthèse d’activité non plus sur un écran mural', () => {
    expect(ROLES_TABLEAU_BORD_ACTIVITE).not.toContain('poste_atelier');
  });
});

describe('ROLES_TABLEAU_BORD_FINANCIER — RF-115 : direction + comptable SEULS, admin exclu', () => {
  it('exactement direction et comptable', () => {
    expect([...ROLES_TABLEAU_BORD_FINANCIER].sort()).toEqual(['comptable', 'direction']);
  });

  it('admin explicitement exclu (RF-115 : aucun droit financier, jamais comblé par copie de direction)', () => {
    expect(ROLES_TABLEAU_BORD_FINANCIER).not.toContain('admin');
  });

  for (const role of ROLES_UTILISATEUR) {
    if (role === 'direction' || role === 'comptable') continue;
    it(`${role} n'a PAS accès aux indicateurs financiers`, () => {
      expect(ROLES_TABLEAU_BORD_FINANCIER).not.toContain(role);
    });
  }
});

describe('verifierRoleAutorise', () => {
  it('ne lève rien pour un rôle autorisé', () => {
    expect(() =>
      verifierRoleAutorise(
        'direction',
        ROLES_TABLEAU_BORD_FINANCIER,
        'tableau_bord.financier.lire',
      ),
    ).not.toThrow();
  });

  it('lève 403 DROIT_INSUFFISANT pour un rôle non autorisé', () => {
    let capturee: unknown;
    try {
      verifierRoleAutorise(
        'chef_atelier' as RoleUtilisateur,
        ROLES_TABLEAU_BORD_FINANCIER,
        'tableau_bord.financier.lire',
      );
    } catch (erreur) {
      capturee = erreur;
    }
    expect(capturee).toBeInstanceOf(ErreurMetier);
    expect((capturee as ErreurMetier).code).toBe('DROIT_INSUFFISANT');
    expect((capturee as ErreurMetier).status).toBe(403);
  });
});
