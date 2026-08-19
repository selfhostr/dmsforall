import { describe, expect, it } from 'vitest';

import {
  DUREE_STABILITE_MS,
  ETAT_STABILITE_INITIAL,
  calculerEtatStabilite,
} from './machineStabiliteCadrage';

describe('calculerEtatStabilite', () => {
  it('cadrage mauvais -> état initial, quel que soit le début de stabilité fourni', () => {
    const resultat = calculerEtatStabilite(false, 10_000, 9_500);
    expect(resultat.etat).toEqual(ETAT_STABILITE_INITIAL);
    expect(resultat.debutStabiliteMs).toBeNull();
  });

  it('premier instant où le cadrage devient bon (aucun début connu) : stable, progression nulle, pas encore déclenché', () => {
    const resultat = calculerEtatStabilite(true, 10_000, null);
    expect(resultat.etat).toEqual({ stable: true, progressionMs: 0, declenche: false });
    expect(resultat.debutStabiliteMs).toBe(10_000);
  });

  it('reporte le début fourni et calcule la progression écoulée, sans déclencher avant le seuil', () => {
    const resultat = calculerEtatStabilite(true, 10_000 + DUREE_STABILITE_MS - 1, 10_000);
    expect(resultat.etat.stable).toBe(true);
    expect(resultat.etat.progressionMs).toBe(DUREE_STABILITE_MS - 1);
    expect(resultat.etat.declenche).toBe(false);
    expect(resultat.debutStabiliteMs).toBe(10_000);
  });

  it('déclenche exactement au palier de durée, ni avant ni après sans raison', () => {
    const resultat = calculerEtatStabilite(true, 10_000 + DUREE_STABILITE_MS, 10_000);
    expect(resultat.etat.declenche).toBe(true);
    expect(resultat.etat.progressionMs).toBe(DUREE_STABILITE_MS);
  });

  it('la progression reste plafonnée à DUREE_STABILITE_MS même bien après le déclenchement (jamais une barre qui déborde)', () => {
    const resultat = calculerEtatStabilite(true, 10_000 + DUREE_STABILITE_MS * 5, 10_000);
    expect(resultat.etat.progressionMs).toBe(DUREE_STABILITE_MS);
    expect(resultat.etat.declenche).toBe(true);
  });

  it('un retour à un cadrage mauvais puis de nouveau bon repart de zéro : jamais de moyenne glissante, jamais de tolérance à une interruption', () => {
    const premier = calculerEtatStabilite(true, 10_000, null);
    const interrompu = calculerEtatStabilite(false, 10_300, premier.debutStabiliteMs);
    const reprise = calculerEtatStabilite(true, 10_400, interrompu.debutStabiliteMs);

    expect(reprise.etat.progressionMs).toBe(0);
    expect(reprise.debutStabiliteMs).toBe(10_400);
  });
});
