import { describe, expect, it } from 'vitest';

import type { EtatMappingExport } from '@dfa/shared';

import {
  appliquerValeursProposees,
  brouillonInitial,
  construireMiseAJour,
  nbValeursProposables,
} from './mapping';

const etat: EtatMappingExport = {
  cible: 'winbiz',
  complet: false,
  nbPostesManquants: 3,
  comptes: [
    {
      usage: 'creances_clients',
      categorie: 'defaut',
      libelle: 'a',
      compte: null,
      actifDu: null,
      compteParDefaut: '1100',
      requis: true,
    },
    {
      usage: 'produit',
      categorie: 'piece',
      libelle: 'b',
      compte: '3200',
      actifDu: '1970-01-01',
      compteParDefaut: '3200',
      requis: true,
    },
    {
      usage: 'arrondi',
      categorie: 'defaut',
      libelle: 'c',
      compte: null,
      actifDu: null,
      compteParDefaut: null,
      requis: false,
    },
  ],
  codesTva: [
    {
      regimeTva: 'normal',
      tauxPourmille: 81,
      libelle: 'd',
      codeExterne: null,
      codeParDefaut: 'TN81',
      requis: true,
    },
  ],
};

describe('mapping des comptes', () => {
  it('part de l’état serveur', () => {
    expect(brouillonInitial(etat)).toEqual({
      'compte:creances_clients:defaut': '',
      'compte:produit:piece': '3200',
      'compte:arrondi:defaut': '',
      'tva:normal:81': '',
    });
  });

  it('remplit seulement les postes vides ayant une suggestion, sans écraser la saisie', () => {
    const saisi = { ...brouillonInitial(etat), 'compte:produit:piece': '3300' };
    const suite = appliquerValeursProposees(etat, saisi);
    expect(suite['compte:creances_clients:defaut']).toBe('1100');
    expect(suite['tva:normal:81']).toBe('TN81');
    expect(suite['compte:produit:piece']).toBe('3300');
    // Pas de suggestion de l'API pour l'arrondi : repli WinBIZ.
    expect(suite['compte:arrondi:defaut']).toBe('3809');
    expect(nbValeursProposables(etat, saisi)).toBe(3);
    expect(nbValeursProposables(etat, suite)).toBe(0);
  });

  it('propose le code TVA 8.1 % et l’arrondi WinBIZ quand l’API ne propose rien', () => {
    const sansSuggestion: EtatMappingExport = {
      ...etat,
      codesTva: etat.codesTva.map((c) => ({ ...c, codeParDefaut: null })),
    };
    const suite = appliquerValeursProposees(sansSuggestion, brouillonInitial(sansSuggestion));
    expect(suite['tva:normal:81']).toBe('N81');
    expect(suite['compte:arrondi:defaut']).toBe('3809');
  });

  it('ne propose aucun repli WinBIZ pour une autre cible', () => {
    const csv: EtatMappingExport = {
      ...etat,
      cible: 'csv',
      codesTva: etat.codesTva.map((c) => ({ ...c, codeParDefaut: null })),
    };
    const suite = appliquerValeursProposees(csv, brouillonInitial(csv));
    expect(suite['tva:normal:81']).toBe('');
    expect(suite['compte:arrondi:defaut']).toBe('');
  });

  it('n’envoie que les postes modifiés', () => {
    const r = construireMiseAJour('winbiz', etat, {
      ...brouillonInitial(etat),
      'compte:creances_clients:defaut': ' 1100 ',
    });
    expect(r).toEqual({
      ok: true,
      entree: {
        cible: 'winbiz',
        comptes: [{ usage: 'creances_clients', categorie: 'defaut', compte: '1100' }],
        codesTva: [],
      },
    });
  });

  it('désigne le poste fautif selon le schéma partagé', () => {
    const r = construireMiseAJour('winbiz', etat, {
      ...brouillonInitial(etat),
      'compte:creances_clients:defaut': '11 00',
    });
    expect(r).toEqual({
      ok: false,
      erreurs: { 'compte:creances_clients:defaut': true },
      rien: false,
    });
  });

  it('signale qu’il n’y a rien à enregistrer', () => {
    expect(construireMiseAJour('winbiz', etat, brouillonInitial(etat))).toEqual({
      ok: false,
      erreurs: {},
      rien: true,
    });
  });
});
