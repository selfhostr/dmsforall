import { describe, expect, it } from 'vitest';

import { mapperLigneTasVersInsertion, type LigneCsvTas } from './import-referentiel-vehicules-ch';

/**
 * Ligne CSV TAS « voitures » minimale mais réaliste — champs mesurés sur un échantillon réel
 * (`TAS_Automobil.csv`, voir en-tête du fichier importé), pas inventés au hasard.
 */
function ligneAutomobil(champs: Partial<LigneCsvTas> = {}): LigneCsvTas {
  return {
    chTypeApprovalNumber: '1AA101',
    vehicleCategoryCode: 'M1',
    makeCode: '3003',
    makeName: 'ALFA ROMEO',
    commercialName: '145 1.9 TD',
    type: '930A4A',
    variant: '',
    version: '',
    chFuelType: 'D',
    driveType: 'V',
    engineType: 'AR 33308',
    engineCapacity: '1929',
    maximumNetPower: '66',
    chMassOfTheVehicleInRunningOrderMinimum: '1195',
    technicallyPermissibleMaximumLadenMassMinimum: '1620',
    chNrOfSeatingPositionsMinimum: '5',
    definitive: '2025-06-04',
    versionNo: '4',
    ...champs,
  };
}

describe('mapperLigneTasVersInsertion — champs obligatoires', () => {
  it('mappe une ligne complète, catégorie automobil', () => {
    const resultat = mapperLigneTasVersInsertion(ligneAutomobil(), 'automobil');

    expect(resultat).toEqual({
      codeTypeCh: '1AA101',
      categorie: 'M1',
      marque: 'ALFA ROMEO',
      marqueCode: '3003',
      modele: '145 1.9 TD',
      typeTechnique: '930A4A',
      variante: null,
      version: null,
      carburantCode: 'D',
      transmissionCode: 'V',
      moteurDesignation: 'AR 33308',
      cylindreeCm3: 1929,
      puissanceKw: 66,
      poidsVideKg: 1195,
      poidsTotalKg: 1620,
      places: 5,
      dateHomologation: '2025-06-04',
      sourceVersionNo: 4,
    });
  });

  it.each([
    ['chTypeApprovalNumber', 'code type absent'],
    ['vehicleCategoryCode', 'catégorie absente'],
    ['makeName', 'marque absente'],
    ['commercialName', 'modèle absent'],
  ])('ignore la ligne (retourne null) quand %s est vide : %s', (champ) => {
    const ligne = ligneAutomobil({ [champ]: '' });
    expect(mapperLigneTasVersInsertion(ligne, 'automobil')).toBeNull();
  });

  it('ignore la ligne quand un champ obligatoire ne contient que des espaces', () => {
    const ligne = ligneAutomobil({ makeName: '   ' });
    expect(mapperLigneTasVersInsertion(ligne, 'automobil')).toBeNull();
  });
});

describe('mapperLigneTasVersInsertion — poids selon la catégorie (piège vérifié : 2 noms de champ ASTRA)', () => {
  it('catégorie automobil : lit chMassOfTheVehicleInRunningOrderMinimum / technicallyPermissibleMaximumLadenMassMinimum', () => {
    const ligne = ligneAutomobil({
      chMassOfTheVehicleInRunningOrderMinimum: '1200',
      technicallyPermissibleMaximumLadenMassMinimum: '1700',
      // Champs moto/remorque présents mais non lus pour cette catégorie : ne doivent PAS être pris.
      chEmptyWeightMinimum: '999',
      techPermMaxLadenMassMin: '999',
    });
    const resultat = mapperLigneTasVersInsertion(ligne, 'automobil');
    expect(resultat?.poidsVideKg).toBe(1200);
    expect(resultat?.poidsTotalKg).toBe(1700);
  });

  it('catégorie motorrad : lit chEmptyWeightMinimum / techPermMaxLadenMassMin, PAS les colonnes automobil', () => {
    const ligne = ligneAutomobil({
      chMassOfTheVehicleInRunningOrderMinimum: '999',
      technicallyPermissibleMaximumLadenMassMinimum: '999',
      chEmptyWeightMinimum: '150',
      techPermMaxLadenMassMin: '320',
    });
    const resultat = mapperLigneTasVersInsertion(ligne, 'motorrad');
    expect(resultat?.poidsVideKg).toBe(150);
    expect(resultat?.poidsTotalKg).toBe(320);
  });

  it('catégorie anhaenger : même mapping que motorrad (vérifié identique sur les en-têtes réels)', () => {
    const ligne = ligneAutomobil({ chEmptyWeightMinimum: '80', techPermMaxLadenMassMin: '750' });
    const resultat = mapperLigneTasVersInsertion(ligne, 'anhaenger');
    expect(resultat?.poidsVideKg).toBe(80);
    expect(resultat?.poidsTotalKg).toBe(750);
  });

  it('places absent (colonne inexistante dans les en-têtes motorrad/anhaenger réels) -> null, jamais une valeur inventée', () => {
    const ligne = ligneAutomobil({ chNrOfSeatingPositionsMinimum: undefined });
    const resultat = mapperLigneTasVersInsertion(ligne, 'motorrad');
    expect(resultat?.places).toBeNull();
  });
});

describe('mapperLigneTasVersInsertion — nombres', () => {
  it('arrondit une puissance fractionnaire (ex. petite cylindrée électrique) au plus proche', () => {
    const ligne = ligneAutomobil({ maximumNetPower: '3.7' });
    expect(mapperLigneTasVersInsertion(ligne, 'automobil')?.puissanceKw).toBe(4);
  });

  it("accepte la virgule décimale en défense, sans jamais l'avoir vue en pratique sur cette source", () => {
    const ligne = ligneAutomobil({ maximumNetPower: '3,2' });
    expect(mapperLigneTasVersInsertion(ligne, 'automobil')?.puissanceKw).toBe(3);
  });

  it('valeur non numérique -> null, jamais NaN ni une exception', () => {
    const ligne = ligneAutomobil({ engineCapacity: 'n/a' });
    expect(mapperLigneTasVersInsertion(ligne, 'automobil')?.cylindreeCm3).toBeNull();
  });

  it('valeur négative -> null (violerait la contrainte >= 0 de la migration 0050 si insérée telle quelle)', () => {
    const ligne = ligneAutomobil({ puissanceKw: '-5', maximumNetPower: '-5' });
    expect(mapperLigneTasVersInsertion(ligne, 'automobil')?.puissanceKw).toBeNull();
  });

  it('places à 0 -> null (contrainte 0050 : places > 0, jamais 0 ni négatif)', () => {
    const ligne = ligneAutomobil({ chNrOfSeatingPositionsMinimum: '0' });
    expect(mapperLigneTasVersInsertion(ligne, 'automobil')?.places).toBeNull();
  });

  it('sourceVersionNo absent -> 0 (défaut de la colonne 0050), jamais null', () => {
    const ligne = ligneAutomobil({ versionNo: '' });
    expect(mapperLigneTasVersInsertion(ligne, 'automobil')?.sourceVersionNo).toBe(0);
  });
});

describe('mapperLigneTasVersInsertion — date', () => {
  it('date ISO valide passée telle quelle (colonne `date`, pas de fuseau à gérer)', () => {
    const ligne = ligneAutomobil({ definitive: '1996-03-21' });
    expect(mapperLigneTasVersInsertion(ligne, 'automobil')?.dateHomologation).toBe('1996-03-21');
  });

  it('format inattendu -> null plutôt que de laisser Postgres échouer toute la ligne', () => {
    const ligne = ligneAutomobil({ definitive: '21.03.1996' });
    expect(mapperLigneTasVersInsertion(ligne, 'automobil')?.dateHomologation).toBeNull();
  });

  it('date absente -> null', () => {
    const ligne = ligneAutomobil({ definitive: '' });
    expect(mapperLigneTasVersInsertion(ligne, 'automobil')?.dateHomologation).toBeNull();
  });
});
