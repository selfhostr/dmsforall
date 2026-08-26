import { describe, expect, it } from 'vitest';
import type { RapportTable } from '../lecteurs/types';

import {
  constatsDepuisProfils,
  projeterFichierArchive,
  projeterTableDetectee,
} from './projection-analyse-reprise';

// `confiance` : échelle FRACTIONNAIRE 0-1, la seule que `lecteurs/` produit réellement
// (`EvaluationRole.confiance`, doctrine de `lecteurs/types.ts`) — jamais 0-100 ici. Un fixture
// écrit sur l'échelle 0-100 masquerait exactement le défaut réel du 25.08.2026 (conversion `* 100`
// oubliée dans `projeterTableDetectee`) : `Math.round(87.4)` passe silencieusement, alors que
// `Math.round(0.874)` révèle immédiatement l'absence du `* 100`.
function rapport(partiel: Partial<RapportTable>): RapportTable {
  return {
    table: 'CLIENTS',
    lignesActives: 42,
    lignesSupprimees: 3,
    evaluations: [
      { role: 'client', confiance: 0.874, raison: 'colonnes correspondantes', signaux: [] },
    ],
    ...partiel,
  };
}

describe('projeterFichierArchive', () => {
  it('transporte les champs bruts, type toujours "inconnu" (classé ailleurs)', () => {
    expect(
      projeterFichierArchive({
        chemin: 'DATA/X.DBF',
        tailleOctets: 1024,
        lisible: true,
        empreinteSha256: 'abc',
      }),
    ).toEqual({
      chemin: 'DATA/X.DBF',
      tailleOctets: 1024,
      type: 'inconnu',
      lisible: true,
      empreinteSha256: 'abc',
    });
  });
});

describe('projeterTableDetectee', () => {
  it('prend la MEILLEURE évaluation (en tête, doctrine lecteurs/) et arrondit la confiance', () => {
    const detectee = projeterTableDetectee('DATA/CLIENTS.DBF', rapport({}), []);
    expect(detectee.roleDeduit).toBe('clients');
    expect(detectee.indiceConfiance).toBe(87);
    expect(detectee.nombreLignes).toBe(42);
    expect(detectee.periodeCouverte).toBeNull();
  });

  it('rôle lecteurs/ inconnu du produit -> role_indetermine côté contrat, jamais planté', () => {
    const detectee = projeterTableDetectee(
      'DATA/X.DBF',
      rapport({
        evaluations: [{ role: 'inconnu', confiance: 0.05, raison: 'aucun signal', signaux: [] }],
      }),
      [],
    );
    expect(detectee.roleDeduit).toBe('inconnu');
  });

  it('aucune évaluation -> role inconnu, confiance nulle, aucun motif', () => {
    const detectee = projeterTableDetectee('DATA/X.DBF', rapport({ evaluations: [] }), []);
    expect(detectee.roleDeduit).toBe('inconnu');
    expect(detectee.indiceConfiance).toBe(0);
    expect(detectee.motifsDeduction).toEqual([]);
  });

  it('signaux de colonnes -> motifsDeduction colonnes_correspondantes, un par signal', () => {
    const detectee = projeterTableDetectee(
      'DATA/CLIENTS.DBF',
      rapport({
        evaluations: [
          {
            role: 'client',
            confiance: 0.8,
            raison: 'x',
            signaux: [
              {
                colonne: 'NOM',
                motif: 'nom_colonne',
                confiance: 0.8,
                raison: 'colonne NOM présente',
              },
              {
                colonne: 'EMAIL',
                motif: 'nom_colonne',
                confiance: 0.6,
                raison: 'colonne EMAIL présente',
              },
            ],
          },
        ],
      }),
      [],
    );
    expect(detectee.motifsDeduction).toHaveLength(2);
    expect(detectee.motifsDeduction[0]).toEqual({
      code: 'colonnes_correspondantes',
      donnees: { colonne: 'NOM', motif: 'nom_colonne', raison: 'colonne NOM présente' },
    });
  });

  it('aucun signal -> motif estimation_faible_confiance', () => {
    const detectee = projeterTableDetectee(
      'DATA/X.DBF',
      rapport({
        evaluations: [{ role: 'client', confiance: 0.45, raison: 'volume seul', signaux: [] }],
      }),
      [],
    );
    expect(detectee.motifsDeduction).toEqual([
      { code: 'estimation_faible_confiance', donnees: { raison: 'volume seul' } },
    ]);
  });
});

describe('constatsDepuisProfils', () => {
  it('remplissage faible (< 30%) -> constat attention', () => {
    const constats = constatsDepuisProfils([
      {
        colonne: 'TEL',
        total: 100,
        remplis: 20,
        nulls: 80,
        vides: 0,
        espacesSeuls: 0,
        tauxRemplissage: 0.2,
      },
    ]);
    expect(constats).toEqual([
      {
        type: 'remplissage_faible',
        champ: 'TEL',
        gravite: 'attention',
        donnees: { tauxRemplissage: 0.2 },
      },
    ]);
  });

  it('format de date ambigu (aaaa.mm.jj) -> constat information', () => {
    const constats = constatsDepuisProfils([
      {
        colonne: 'DATE_NAISS',
        total: 10,
        remplis: 10,
        nulls: 0,
        vides: 0,
        espacesSeuls: 0,
        tauxRemplissage: 1,
        formatDateDetecte: 'aaaa.mm.jj',
      },
    ]);
    expect(constats).toEqual([
      {
        type: 'format_date_ambigu',
        champ: 'DATE_NAISS',
        gravite: 'information',
        donnees: { formatDetecte: 'aaaa.mm.jj' },
      },
    ]);
  });

  it('dates aberrantes (erreur de siècle) -> constat BLOQUANT', () => {
    const constats = constatsDepuisProfils([
      {
        colonne: 'DATE_1RE_CIRC',
        total: 50,
        remplis: 50,
        nulls: 0,
        vides: 0,
        espacesSeuls: 0,
        tauxRemplissage: 1,
        datesAberrantes: 3,
      },
    ]);
    expect(constats).toContainEqual({
      type: 'dates_aberrantes',
      champ: 'DATE_1RE_CIRC',
      gravite: 'bloquante',
      donnees: { nombre: 3 },
    });
  });

  it('colonne saine (bon remplissage, pas de date) -> aucun constat', () => {
    const constats = constatsDepuisProfils([
      {
        colonne: 'NOM',
        total: 100,
        remplis: 98,
        nulls: 2,
        vides: 0,
        espacesSeuls: 0,
        tauxRemplissage: 0.98,
      },
    ]);
    expect(constats).toEqual([]);
  });
});
