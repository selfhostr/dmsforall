import { describe, expect, it } from 'vitest';

import { ligneVehiculeDuDossier } from './ligne-vehicule-dossier';

function dossierAvecPrix(prix: number | null) {
  return {
    vehicule: {
      id: 'vs-1',
      vehicule: { designation: 'VW Golf 8 1.5 TSI' },
      prixVenteAfficheCentimes: prix,
    },
  } as never;
}

describe('ligneVehiculeDuDossier', () => {
  it("reporte le prix du véhicule (24'900.00 = 2490000 ct) sur une ligne de quantité 1", () => {
    const r = ligneVehiculeDuDossier(dossierAvecPrix(2490000), '2026-11-08');
    expect(r.blocage).toBeNull();
    expect(r.ligne).toEqual({
      type: 'forfait',
      designation: 'VW Golf 8 1.5 TSI',
      quantiteMillieme: 1000,
      prixUnitaireTtcCentimes: 2490000,
      regimeTva: 'normal',
      tauxTvaPourmille: 81,
      datePrestation: '2026-11-08',
    });
  });

  it('bloque un dossier sans prix (null)', () => {
    expect(ligneVehiculeDuDossier(dossierAvecPrix(null))).toEqual({
      ligne: null,
      blocage: 'sansPrix',
    });
  });

  it('bloque un prix à 0', () => {
    expect(ligneVehiculeDuDossier(dossierAvecPrix(0)).blocage).toBe('sansPrix');
  });

  it('bloque un dossier sans véhicule', () => {
    expect(ligneVehiculeDuDossier({ vehicule: null } as never).blocage).toBe('sansVehicule');
  });
});
