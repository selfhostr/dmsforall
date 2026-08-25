import { describe, expect, it } from 'vitest';

import { reconstituerIntervallesSansChevauchement } from './reconstruction-intervalles';

describe('reconstituerIntervallesSansChevauchement', () => {
  it("referme l'intervalle précédent à la date de début du suivant, MÊME CLÉ (plaque réattribuée)", () => {
    // Deux véhicules successifs ont porté la MÊME plaque : un import ligne à ligne naïf produirait
    // deux daterange [du, +∞) qui se chevauchent -> EXCLUDE GiST refuserait le second INSERT
    // (vehicule_plaque_collision_excl, migration 0007). La reconstruction doit fermer le premier.
    const resultat = reconstituerIntervallesSansChevauchement([
      { cle: 'VD123456', du: '2018-03-01', donnees: { vehiculeId: 'v1' } },
      { cle: 'VD123456', du: '2021-07-15', donnees: { vehiculeId: 'v2' } },
    ]);

    expect(resultat).toEqual([
      { cle: 'VD123456', du: '2018-03-01', au: '2021-07-15', donnees: { vehiculeId: 'v1' } },
      { cle: 'VD123456', du: '2021-07-15', au: null, donnees: { vehiculeId: 'v2' } },
    ]);
  });

  it('le DERNIER enregistrement par clé reste ouvert (au = null)', () => {
    const resultat = reconstituerIntervallesSansChevauchement([
      { cle: 'v1', du: '2015-01-01', donnees: { clientId: 'a' } },
      { cle: 'v1', du: '2020-06-01', donnees: { clientId: 'b' } },
      { cle: 'v1', du: '2023-11-01', donnees: { clientId: 'c' } },
    ]);
    expect(resultat.map((r) => r.au)).toEqual(['2020-06-01', '2023-11-01', null]);
  });

  it('trie par date même si la source arrive dans le désordre', () => {
    const resultat = reconstituerIntervallesSansChevauchement([
      { cle: 'v1', du: '2023-01-01', donnees: { id: 'plus-recent' } },
      { cle: 'v1', du: '2019-01-01', donnees: { id: 'plus-ancien' } },
    ]);
    expect(resultat[0]!.donnees).toEqual({ id: 'plus-ancien' });
    expect(resultat[0]!.au).toBe('2023-01-01');
  });

  it('fusionne un doublon source pur (même clé, même date) — ne produit jamais un intervalle de longueur nulle', () => {
    // Un intervalle [du, du) violerait vehicule_plaque_periode_chk / vehicule_detention_periode_chk
    // (`au is null or au > du`, migration 0007).
    const resultat = reconstituerIntervallesSansChevauchement([
      { cle: 'v1', du: '2020-01-01', donnees: { source: 'export-1' } },
      { cle: 'v1', du: '2020-01-01', donnees: { source: 'export-2 (doublon)' } },
    ]);
    expect(resultat).toEqual([
      { cle: 'v1', du: '2020-01-01', au: null, donnees: { source: 'export-1' } },
    ]);
    for (const intervalle of resultat) {
      if (intervalle.au !== null) expect(intervalle.au > intervalle.du).toBe(true);
    }
  });

  it('des clés différentes ne se referment jamais mutuellement', () => {
    const resultat = reconstituerIntervallesSansChevauchement([
      { cle: 'plaque-A', du: '2020-01-01', donnees: {} },
      { cle: 'plaque-B', du: '2020-06-01', donnees: {} },
    ]);
    expect(resultat.find((r) => r.cle === 'plaque-A')!.au).toBeNull();
    expect(resultat.find((r) => r.cle === 'plaque-B')!.au).toBeNull();
  });

  it('liste vide -> résultat vide', () => {
    expect(reconstituerIntervallesSansChevauchement([])).toEqual([]);
  });
});
