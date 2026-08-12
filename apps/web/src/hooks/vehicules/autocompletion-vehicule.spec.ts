import { describe, expect, it } from 'vitest';

import {
  estValeurDansReferentiel,
  normaliserPourComparaison,
  type OptionAutocompletionVehicule,
} from './autocompletion-vehicule';

describe('normaliserPourComparaison', () => {
  it('ignore la casse et les accents', () => {
    expect(normaliserPourComparaison('Citroën')).toBe(normaliserPourComparaison('citroen'));
    expect(normaliserPourComparaison('MERCEDES-BENZ')).toBe(
      normaliserPourComparaison('mercedes-benz'),
    );
  });

  it('ignore les espaces en bordure', () => {
    expect(normaliserPourComparaison('  Škoda  ')).toBe(normaliserPourComparaison('Skoda'));
  });
});

describe('estValeurDansReferentiel', () => {
  const options: readonly OptionAutocompletionVehicule[] = [
    { valeur: 'Volkswagen', complement: '42 modèles' },
    { valeur: 'Citroën', complement: '18 modèles' },
  ];

  it('une saisie vide est toujours considérée comme "dans le référentiel" — absence de donnée, pas une valeur hors norme', () => {
    expect(estValeurDansReferentiel('', options)).toBe(true);
    expect(estValeurDansReferentiel('   ', options)).toBe(true);
  });

  it('reconnaît une correspondance exacte, y compris en tolérant casse et accents', () => {
    expect(estValeurDansReferentiel('volkswagen', options)).toBe(true);
    expect(estValeurDansReferentiel('CITROEN', options)).toBe(true);
    expect(estValeurDansReferentiel('  Citroën  ', options)).toBe(true);
  });

  it('une saisie sans correspondance exacte parmi les options connues est hors référentiel', () => {
    expect(estValeurDansReferentiel('Lada', options)).toBe(false);
  });

  it('une correspondance partielle (préfixe) ne compte pas comme une correspondance exacte', () => {
    expect(estValeurDansReferentiel('Volkswag', options)).toBe(false);
  });

  it('sans aucune option connue, toute saisie non vide est hors référentiel', () => {
    expect(estValeurDansReferentiel('Volkswagen', [])).toBe(false);
  });
});
