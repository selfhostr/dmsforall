import type { ReponseVehiculeKilometrage } from '@dfa/shared';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { FriseKilometrage } from './FriseKilometrage';

const RELEVE: ReponseVehiculeKilometrage = {
  id: 'k1',
  valeur: 85000,
  unite: 'km',
  valeurKm: 85000,
  releveLe: '2026-01-15T08:30:00.000Z',
  source: 'reception',
  motifRegression: null,
  ordreReparationId: null,
};

describe('FriseKilometrage', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('affiche la valeur canonique en km et la source du relevé', () => {
    render(<FriseKilometrage releves={[RELEVE]} />);
    expect(screen.getByText(/85'000 km/)).toBeInTheDocument();
    expect(screen.getByText('Réception')).toBeInTheDocument();
  });

  it("affiche la valeur d'origine en complément quand la saisie était en milles", () => {
    render(
      <FriseKilometrage releves={[{ ...RELEVE, valeur: 55000, unite: 'mi', valeurKm: 88514 }]} />,
    );
    expect(screen.getByText(/88'514 km/)).toBeInTheDocument();
    expect(screen.getByText(/55'000 mi/)).toBeInTheDocument();
  });

  it('signale le motif de régression sans jamais le calculer soi-même', () => {
    render(<FriseKilometrage releves={[{ ...RELEVE, motifRegression: 'compteur_remplace' }]} />);
    expect(screen.getByText('Compteur remplacé')).toBeInTheDocument();
  });

  it('affiche un état vide dédié en l’absence de relevé', () => {
    render(<FriseKilometrage releves={[]} />);
    expect(screen.getByText('Aucun kilométrage relevé')).toBeInTheDocument();
  });

  it('traduit le libellé de source en allemand', async () => {
    await i18n.changeLanguage('de');
    render(<FriseKilometrage releves={[RELEVE]} />);
    expect(screen.getByText('Annahme')).toBeInTheDocument();
  });
});
