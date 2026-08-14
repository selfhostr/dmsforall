import { describe, expect, it } from 'vitest';

import { calculerDisponibilitePiece, convertirTtcVersHtCentimes } from './disponibilite-piece';

describe('calculerDisponibilitePiece', () => {
  it('rend "nonSuiviNullePart" — jamais suivi sur aucun site, quelle que soit la quantité rendue', () => {
    expect(calculerDisponibilitePiece('nonSuiviNullePart', 0)).toEqual({
      type: 'nonSuiviNullePart',
    });
  });

  it('rend "nonSuiviSurCeSite" — suivi ailleurs mais pas ici, distinct de "aucune"', () => {
    expect(calculerDisponibilitePiece('nonSuiviSurCeSite', 0)).toEqual({
      type: 'nonSuiviSurCeSite',
    });
  });

  it('rend "aucune" quand suivi à ce site mais quantité nulle', () => {
    expect(calculerDisponibilitePiece('suivi', 0)).toEqual({ type: 'aucune' });
  });

  it('rend "aucune" pour une quantité disponible négative (réservations > physique)', () => {
    expect(calculerDisponibilitePiece('suivi', -500)).toEqual({ type: 'aucune' });
  });

  it('rend "disponible" avec la quantité en millièmes quand suivi et positif', () => {
    expect(calculerDisponibilitePiece('suivi', 2500)).toEqual({
      type: 'disponible',
      quantiteMillieme: 2500,
    });
  });
});

describe('convertirTtcVersHtCentimes', () => {
  it('convertit au taux standard 8.1% avec arrondi au centime — jamais une copie brute du TTC', () => {
    // 6850 * 1000 / 1081 = 6336.72... -> 6337. Reproduit l'anecdote terrain (68.50 saisi, 74.05
    // affiché) DANS L'AUTRE SENS : ce calcul part du TTC catalogue et rend le HT à préremplir,
    // jamais le TTC lui-même copié tel quel dans le champ HT.
    expect(convertirTtcVersHtCentimes(6850, 81)).toBe(6337);
  });

  it('convertit à un taux réduit (2.6%)', () => {
    // 1000 * 1000 / 1026 = 974.65... -> 975
    expect(convertirTtcVersHtCentimes(1000, 26)).toBe(975);
  });

  it('taux nul : HT = TTC', () => {
    expect(convertirTtcVersHtCentimes(1234, 0)).toBe(1234);
  });

  it('zéro reste zéro quel que soit le taux', () => {
    expect(convertirTtcVersHtCentimes(0, 81)).toBe(0);
  });
});
