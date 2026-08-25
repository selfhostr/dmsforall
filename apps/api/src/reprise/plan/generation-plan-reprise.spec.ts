import { describe, expect, it } from 'vitest';
import type { TableDetecteeReprise } from '@dfa/shared';

import { genererPlanDepuisTables } from './generation-plan-reprise';

function table(partiel: Partial<TableDetecteeReprise>): TableDetecteeReprise {
  return {
    id: 'table-1',
    fichierChemin: 'DATA/CLIENTS.DBF',
    nomTechnique: 'CLIENTS',
    roleDeduit: 'clients',
    indiceConfiance: 90,
    motifsDeduction: [],
    nombreLignes: 100,
    periodeCouverte: null,
    constatsQualite: [],
    ...partiel,
  };
}

describe('genererPlanDepuisTables', () => {
  it('table exploitable, confiance suffisante -> un élément inclus par défaut', () => {
    const { elements, exclusions } = genererPlanDepuisTables([table({})]);
    expect(exclusions).toEqual([]);
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({
      domaine: 'clients',
      tableDetecteeId: 'table-1',
      inclus: true,
      ajustable: true,
      volumeAttenduLignes: 100,
    });
  });

  it('referentiel_constructeur -> TOUJOURS exclu (D-34), quelle que soit la confiance', () => {
    const { elements, exclusions } = genererPlanDepuisTables([
      table({ id: 't1', roleDeduit: 'referentiel_constructeur', indiceConfiance: 99 }),
    ]);
    expect(elements).toEqual([]);
    expect(exclusions).toEqual([
      { tableDetecteeId: 't1', motif: 'referentiel_constructeur_jamais_repris' },
    ]);
  });

  it('comptabilite_generale -> exclu (D-33, soldes ouverts traités ailleurs, jamais par cette table)', () => {
    const { exclusions } = genererPlanDepuisTables([
      table({ id: 't1', roleDeduit: 'comptabilite_generale' }),
    ]);
    expect(exclusions).toEqual([{ tableDetecteeId: 't1', motif: 'comptabilite_non_reprise' }]);
  });

  it('table vide (0 lignes actives) -> exclue, motif table_vide', () => {
    const { exclusions } = genererPlanDepuisTables([table({ id: 't1', nombreLignes: 0 })]);
    expect(exclusions).toEqual([{ tableDetecteeId: 't1', motif: 'table_vide' }]);
  });

  it("confiance sous le seuil -> exclue, motif role_indetermine (jamais importée à l'aveugle)", () => {
    const { exclusions } = genererPlanDepuisTables([table({ id: 't1', indiceConfiance: 10 })]);
    expect(exclusions[0]).toMatchObject({ tableDetecteeId: 't1', motif: 'role_indetermine' });
  });

  it('rôle inconnu -> exclu, role_indetermine', () => {
    const { exclusions } = genererPlanDepuisTables([table({ id: 't1', roleDeduit: 'inconnu' })]);
    expect(exclusions).toEqual([{ tableDetecteeId: 't1', motif: 'role_indetermine' }]);
  });

  it("deux tables candidates au même rôle -> seule la MEILLEURE devient élément, l'autre exclue en doublon", () => {
    const forte = table({ id: 'forte', indiceConfiance: 90, nombreLignes: 500 });
    const faible = table({ id: 'faible', indiceConfiance: 60, nombreLignes: 10 });
    const { elements, exclusions } = genererPlanDepuisTables([faible, forte]);

    expect(elements).toHaveLength(1);
    expect(elements[0]!.tableDetecteeId).toBe('forte');
    expect(exclusions).toEqual([
      {
        tableDetecteeId: 'faible',
        motif: 'doublon_table_meme_role',
        donnees: { tableRetenueId: 'forte' },
      },
    ]);
  });

  it('index_documents_scannes SANS rattachement (index source) -> exclu, document_non_rattachable (D-32)', () => {
    const { exclusions } = genererPlanDepuisTables([
      table({ id: 't1', roleDeduit: 'index_documents_scannes' }),
    ]);
    expect(exclusions).toEqual([{ tableDetecteeId: 't1', motif: 'document_non_rattachable' }]);
  });

  it('index_documents_scannes AVEC rattachement -> inclus, périmètre documents_scannes_rattaches', () => {
    const { elements } = genererPlanDepuisTables(
      [table({ id: 't1', roleDeduit: 'index_documents_scannes' })],
      new Set(['t1']),
    );
    expect(elements[0]).toMatchObject({
      domaine: 'documents_scannes',
      perimetre: 'documents_scannes_rattaches',
    });
  });

  it('ordre de réparation -> périmètre detail_24_mois_glissants_et_ouverts (D-29)', () => {
    const { elements } = genererPlanDepuisTables([
      table({ id: 't1', roleDeduit: 'ordres_reparation' }),
    ]);
    expect(elements[0]!.perimetre).toBe('detail_24_mois_glissants_et_ouverts');
  });

  it('document de vente -> périmètre entetes_totaux_tva_10_ans (D-30)', () => {
    const { elements } = genererPlanDepuisTables([
      table({ id: 't1', roleDeduit: 'documents_vente' }),
    ]);
    expect(elements[0]!.perimetre).toBe('entetes_totaux_tva_10_ans');
  });

  it('liste vide -> plan vide des deux côtés', () => {
    expect(genererPlanDepuisTables([])).toEqual({ elements: [], exclusions: [] });
  });
});
