import { describe, expect, it } from 'vitest';
import { evaluerRoleTable } from './detecteur-role';
import type { LigneTable } from './types';

function construireLignes(valeurs: Record<string, unknown>[]): LigneTable[] {
  return valeurs.map((v, i) => ({ index: i, valeurs: v as Record<string, never> }));
}

const NOMS_PRENOMS = ['Dupont Jean', 'Meier Anna', 'Rossi Marco', 'Keller Nicole', 'Favre Luc'];

function tableClientPlausible(): LigneTable[] {
  return construireLignes(
    Array.from({ length: 20 }, (_, i) => ({
      NOM: NOMS_PRENOMS[i % NOMS_PRENOMS.length],
      EMAIL: `client${i}@example.ch`,
      NPA: String(1000 + (i % 9) * 100),
      VILLE: 'Lausanne',
    })),
  );
}

function tableVehiculePlausible(): LigneTable[] {
  return construireLignes(
    Array.from({ length: 20 }, (_, i) => ({
      CHASSIS: `WVWZZZ1JZXW${String(100000 + i).padStart(6, '0')}`,
      PLAQUE: `VD${100000 + i}`,
      MARQUE: 'VW',
    })),
  );
}

describe('evaluerRoleTable', () => {
  it('classe une table client plausible en tête, avec confiance et raison', () => {
    const rapport = evaluerRoleTable({
      table: 'X1',
      nomsColonnes: ['NOM', 'EMAIL', 'NPA', 'VILLE'],
      lignesActives: tableClientPlausible(),
    });
    expect(rapport.evaluations[0]!.role).toBe('client');
    expect(rapport.evaluations[0]!.confiance).toBeGreaterThan(0.15);
    expect(rapport.evaluations[0]!.raison.length).toBeGreaterThan(10);
    expect(rapport.evaluations[0]!.signaux.length).toBeGreaterThan(0);
  });

  it('classe une table véhicule plausible en tête (châssis + plaque)', () => {
    const rapport = evaluerRoleTable({
      table: 'X2',
      nomsColonnes: ['CHASSIS', 'PLAQUE', 'MARQUE'],
      lignesActives: tableVehiculePlausible(),
    });
    expect(rapport.evaluations[0]!.role).toBe('vehicule');
  });

  it("classe correctement une table au nom trompeur par son contenu, jamais par le nom (nom = 'ZzArchive_tmp99', contenu = client)", () => {
    const rapport = evaluerRoleTable({
      table: 'ZzArchive_tmp99',
      nomsColonnes: ['NOM', 'EMAIL', 'NPA', 'VILLE'],
      lignesActives: tableClientPlausible(),
    });
    expect(rapport.evaluations[0]!.role).toBe('client');
  });

  it("une table vide portant un nom métier ('Clients') n'est jamais prise pour la bonne", () => {
    const rapport = evaluerRoleTable({
      table: 'Clients',
      nomsColonnes: ['NOM', 'EMAIL'],
      lignesActives: [],
    });
    expect(rapport.evaluations).toHaveLength(1);
    expect(rapport.evaluations[0]!.role).toBe('inconnu');
    expect(rapport.evaluations[0]!.confiance).toBe(0);
    expect(rapport.lignesActives).toBe(0);
  });

  it('classe une table article plausible (code + prix + désignation)', () => {
    const lignes = construireLignes(
      Array.from({ length: 20 }, (_, i) => ({
        CODE_ART: `ART-${1000 + i}`,
        PRIX: 12.5 + i,
        DESIGNATION: `Plaquette de frein avant référence ${i} pour véhicule utilitaire léger`,
      })),
    );
    const rapport = evaluerRoleTable({
      table: 'T3',
      nomsColonnes: ['CODE_ART', 'PRIX', 'DESIGNATION'],
      lignesActives: lignes,
    });
    expect(rapport.evaluations[0]!.role).toBe('article');
  });

  it('classe une table de paiements plausible (montant + date + mode répété)', () => {
    const modes = ['CB', 'ESP', 'VIR'];
    const lignes = construireLignes(
      Array.from({ length: 30 }, (_, i) => ({
        MONTANT: 45.5 + i,
        DATE_PAIEMENT: new Date(Date.UTC(2024, i % 12, 5)),
        MODE: modes[i % modes.length],
      })),
    );
    const rapport = evaluerRoleTable({
      table: 'T4',
      nomsColonnes: ['MONTANT', 'DATE_PAIEMENT', 'MODE'],
      lignesActives: lignes,
    });
    expect(rapport.evaluations[0]!.role).toBe('paiement');
  });

  it("classe une table d'index documentaire (colonnes noms de fichiers)", () => {
    const lignes = construireLignes(
      Array.from({ length: 20 }, (_, i) => ({
        ID: `DOC-${i}`,
        FICHIER: `scan_dossier_${i}.pdf`,
      })),
    );
    const rapport = evaluerRoleTable({
      table: 'T5',
      nomsColonnes: ['ID', 'FICHIER'],
      lignesActives: lignes,
    });
    expect(rapport.evaluations[0]!.role).toBe('index_documentaire');
  });

  it('rend inconnu quand aucun signal ne dépasse le seuil', () => {
    const lignes = construireLignes(
      Array.from({ length: 10 }, (_, i) => ({ COL_X: `valeur-${i}` })),
    );
    const rapport = evaluerRoleTable({
      table: 'T6',
      nomsColonnes: ['COL_X'],
      lignesActives: lignes,
    });
    expect(rapport.evaluations[0]!.role).toBe('inconnu');
  });

  it('toutes les évaluations rendues portent une confiance dans [0,1] et une raison non vide', () => {
    const rapport = evaluerRoleTable({
      table: 'T7',
      nomsColonnes: ['NOM', 'EMAIL', 'NPA', 'VILLE'],
      lignesActives: tableClientPlausible(),
    });
    for (const evaluation of rapport.evaluations) {
      expect(evaluation.confiance).toBeGreaterThanOrEqual(0);
      expect(evaluation.confiance).toBeLessThanOrEqual(1);
      expect(evaluation.raison.length).toBeGreaterThan(0);
    }
  });

  it('les évaluations sont triées par confiance décroissante', () => {
    const rapport = evaluerRoleTable({
      table: 'T8',
      nomsColonnes: ['NOM', 'EMAIL', 'NPA', 'VILLE'],
      lignesActives: tableClientPlausible(),
    });
    const confiances = rapport.evaluations.map((e) => e.confiance);
    const triees = [...confiances].sort((a, b) => b - a);
    expect(confiances).toEqual(triees);
  });
});
