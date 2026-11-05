import { describe, expect, it } from 'vitest';
import type { ElementPlanReprise, TableDetecteeReprise } from '@dfa/shared';

import { genererPlanDepuisTables, planSansElementInclus } from './generation-plan-reprise';

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

  it('confiance ÉGALE (arrondie) entre deux copies rivales -> la plus VOLUMINEUSE gagne, jamais celle vue en premier (défaut réel du 26.08.2026, archive Auto-i)', () => {
    const petite = table({
      id: 'petite',
      fichierChemin: 'AutoI/Anwender_corrompu.mdb',
      indiceConfiance: 90,
      nombreLignes: 7000,
    });
    const grosse = table({
      id: 'grosse',
      fichierChemin: 'AutoI/RepAw.backup',
      indiceConfiance: 90,
      nombreLignes: 9000,
    });

    // Ordre du tableau = la copie la PLUS PETITE arrive EN PREMIER (exactement le cas qui faisait
    // gagner l'ordre du zip avant ce correctif) : la plus volumineuse doit gagner malgré tout.
    const { elements } = genererPlanDepuisTables([petite, grosse]);
    expect(elements).toHaveLength(1);
    expect(elements[0]!.tableDetecteeId).toBe('grosse');

    // Preuve que ce n'est PAS un artefact d'ordre de tableau : même résultat, ordre inversé.
    const inverse = genererPlanDepuisTables([grosse, petite]);
    expect(inverse.elements[0]!.tableDetecteeId).toBe('grosse');
  });

  it('confiance ET volume STRICTEMENT égaux -> départage déterministe par chemin de fichier (jamais un hasard d’ordre)', () => {
    const a = table({ id: 'a', fichierChemin: 'AutoI/Anwender20100107.mdb', indiceConfiance: 90 });
    const b = table({ id: 'b', fichierChemin: 'AutoI/Anwender20100408.mdb', indiceConfiance: 90 });

    const dansUnSens = genererPlanDepuisTables([b, a]);
    const dansLAutreSens = genererPlanDepuisTables([a, b]);

    // Même résultat quel que soit l'ordre d'entrée : "Anwender20100107.mdb" < "Anwender20100408.mdb"
    // lexicographiquement — un choix arbitraire mais STABLE, jamais une lecture du nom du fichier.
    expect(dansUnSens.elements[0]!.tableDetecteeId).toBe('a');
    expect(dansLAutreSens.elements[0]!.tableDetecteeId).toBe('a');
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

function element(partiel: Partial<ElementPlanReprise>): ElementPlanReprise {
  return {
    id: 'e1',
    domaine: 'clients',
    tableDetecteeId: 'table-1',
    perimetre: 'entetes_totaux_tva_10_ans',
    volumeAttenduLignes: 10,
    inclus: true,
    ajustable: true,
    ...partiel,
  };
}

describe('planSansElementInclus (garde-fou validation, défaut 25.08.2026)', () => {
  it('aucun élément du tout -> vide', () => {
    expect(planSansElementInclus([])).toBe(true);
  });

  it('tous les éléments décochés (exclusion_manuelle via PATCH) -> vide', () => {
    expect(
      planSansElementInclus([
        element({ id: 'a', inclus: false }),
        element({ id: 'b', inclus: false }),
      ]),
    ).toBe(true);
  });

  it('au moins un élément inclus -> pas vide', () => {
    expect(
      planSansElementInclus([
        element({ id: 'a', inclus: false }),
        element({ id: 'b', inclus: true }),
      ]),
    ).toBe(false);
  });
});
