import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { SuiviGarantie } from '@dfa/shared';

import '@/i18n';

import { CelluleGarantieSuivi } from './CelluleGarantieSuivi';

describe('CelluleGarantieSuivi', () => {
  it('aucune garantie sur le dossier : tiret, pas d’erreur', () => {
    render(<CelluleGarantieSuivi garantie={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('garantie avec durée connue : affiche la date de fin calculée, jamais un texte vide', () => {
    const garantie: SuiviGarantie = {
      debutLe: '2024-08-04',
      mois: 24,
      plafondKm: 100000,
      finLe: '2026-08-04',
      active: true,
    };
    render(<CelluleGarantieSuivi garantie={garantie} />);
    expect(screen.getByText('Garantie active')).toBeInTheDocument();
    expect(screen.getByText(/Jusqu'au \d{2}\.\d{2}\.2026/)).toBeInTheDocument();
    expect(screen.getByText(/100'000 km/)).toBeInTheDocument();
  });

  it("durée de garantie inconnue : aucune date de fin n'est inventée, texte explicite à la place", () => {
    // Le serveur ne porte qu'une date de DÉBUT de garantie — `mois` inconnu => `finLe: null`
    // (voir l'en-tête de `contrats/ventes/suivi.ts`). Une couverture annoncée à tort est un
    // litige avec un client : ce test échoue si une date de fin apparaît malgré `finLe: null`.
    const garantieSansDuree: SuiviGarantie = {
      debutLe: '2024-08-04',
      mois: null,
      plafondKm: null,
      finLe: null,
      active: true,
    };
    render(<CelluleGarantieSuivi garantie={garantieSansDuree} />);
    expect(screen.getByText('Durée non renseignée — fin non déterminable')).toBeInTheDocument();
    expect(screen.queryByText(/Jusqu'au/)).not.toBeInTheDocument();
  });
});
