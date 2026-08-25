import { describe, expect, it } from 'vitest';
import { detecterLiens, suggererPairesEnTeteLignes, type TableEchantillonnee } from './liens';
import type { LigneTable } from './types';

function lignes(colonne: string, valeurs: string[]): LigneTable[] {
  return valeurs.map((v, i) => ({ index: i, valeurs: { [colonne]: v } }));
}

describe('detecterLiens', () => {
  it("mesure un lien fort quand une colonne source s'apparie très majoritairement à une clé cible", () => {
    const clients: TableEchantillonnee = {
      nom: 'Clients',
      colonnes: ['ID_CLIENT'],
      lignes: lignes('ID_CLIENT', ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']),
    };
    const factures: TableEchantillonnee = {
      nom: 'Factures',
      colonnes: ['REF_CLIENT'],
      lignes: lignes('REF_CLIENT', ['C1', 'C1', 'C2', 'C3', 'C3', 'C9']), // C9 n'existe pas côté clients
    };

    const liens = detecterLiens([clients, factures]);
    const lien = liens.find((l) => l.tableSource === 'Factures' && l.tableCible === 'Clients');
    expect(lien).toBeDefined();
    expect(lien!.tauxAppariement).toBeCloseTo(5 / 6, 2);
    expect(lien!.raison.length).toBeGreaterThan(10);
  });

  it("ne retient pas une colonne cible qui n'est pas quasi unique (pas une clé plausible)", () => {
    const a: TableEchantillonnee = {
      nom: 'A',
      colonnes: ['STATUT'],
      lignes: lignes('STATUT', ['OUVERT', 'OUVERT', 'FERME', 'FERME', 'FERME']),
    };
    const b: TableEchantillonnee = {
      nom: 'B',
      colonnes: ['X'],
      lignes: lignes('X', ['OUVERT', 'FERME', 'OUVERT', 'FERME', 'OUVERT']),
    };
    const liens = detecterLiens([a, b]);
    expect(liens.find((l) => l.tableCible === 'A')).toBeUndefined();
  });

  it('ne retient pas un appariement sous le seuil (coïncidence faible)', () => {
    const cibles: TableEchantillonnee = {
      nom: 'Cible',
      colonnes: ['K'],
      lignes: lignes('K', ['K1', 'K2', 'K3', 'K4', 'K5']),
    };
    const source: TableEchantillonnee = {
      nom: 'Source',
      colonnes: ['V'],
      lignes: lignes('V', ['K1', 'X', 'Y', 'Z', 'W']),
    };
    const liens = detecterLiens([cibles, source]);
    expect(liens).toEqual([]);
  });

  it('rend un tableau vide sans lien plausible (aucune coïncidence)', () => {
    const a: TableEchantillonnee = {
      nom: 'A',
      colonnes: ['K'],
      lignes: lignes('K', ['A1', 'A2', 'A3', 'A4', 'A5']),
    };
    const b: TableEchantillonnee = {
      nom: 'B',
      colonnes: ['V'],
      lignes: lignes('V', ['B1', 'B2', 'B3', 'B4', 'B5']),
    };
    expect(detecterLiens([a, b])).toEqual([]);
  });
});

describe('suggererPairesEnTeteLignes', () => {
  it('propose une paire en-tête/lignes quand le lien existe et le ratio de cardinalité est net', () => {
    const tables = [
      { nom: 'Factures', lignesActives: 100 },
      { nom: 'LignesFactures', lignesActives: 400 },
    ];
    const liens = [
      {
        tableSource: 'LignesFactures',
        colonneSource: 'REF_FACTURE',
        tableCible: 'Factures',
        colonneCible: 'ID_FACTURE',
        tauxAppariement: 0.98,
        raison: 'r',
      },
    ];
    const paires = suggererPairesEnTeteLignes(tables, liens);
    expect(paires).toHaveLength(1);
    expect(paires[0]).toMatchObject({ enTete: 'Factures', lignes: 'LignesFactures' });
    expect(paires[0]!.ratio).toBeCloseTo(4, 5);
  });

  it('ignore une paire dont le ratio de cardinalité est trop faible pour être décisif', () => {
    const tables = [
      { nom: 'A', lignesActives: 100 },
      { nom: 'B', lignesActives: 105 },
    ];
    const liens = [
      {
        tableSource: 'B',
        colonneSource: 'X',
        tableCible: 'A',
        colonneCible: 'ID',
        tauxAppariement: 0.9,
        raison: 'r',
      },
    ];
    expect(suggererPairesEnTeteLignes(tables, liens)).toEqual([]);
  });
});
