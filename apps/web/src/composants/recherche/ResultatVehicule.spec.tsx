import type { ResultatRecherche } from '@dfa/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { ResultatVehicule } from './ResultatVehicule';

const RESULTAT_VEHICULE_COURANT: ResultatRecherche = {
  type: 'vehicule',
  id: 'v1',
  score: 0.94,
  correspondance: { champ: 'plaque', valeur: 'VD 123456', historique: false },
  resume: {
    plaque: 'VD 123456',
    designation: 'VW Touran 2.0 TDI',
    annee: 2018,
    detenteurNom: 'Meier Hans',
    ordreReparationOuvert: { id: 'or1', numero: 'OR-2026-1042' },
  },
};

describe('ResultatVehicule', () => {
  it('affiche plaque, désignation, année et détenteur', () => {
    render(<ResultatVehicule resultat={RESULTAT_VEHICULE_COURANT} />);
    expect(screen.getByText(/VD 123456/)).toBeInTheDocument();
    expect(screen.getByText(/VW Touran 2\.0 TDI \(2018\)/)).toBeInTheDocument();
    expect(screen.getByText('Meier Hans')).toBeInTheDocument();
  });

  it('signale un OR en cours', () => {
    render(<ResultatVehicule resultat={RESULTAT_VEHICULE_COURANT} />);
    expect(screen.getByText('OR en cours')).toBeInTheDocument();
  });

  it('marque un résultat historique visuellement et sémantiquement (role="note")', () => {
    const resultatHistorique: ResultatRecherche = {
      ...RESULTAT_VEHICULE_COURANT,
      id: 'v2',
      correspondance: {
        champ: 'plaque',
        valeur: 'VD 123456',
        historique: true,
        porteeJusquLe: '2025-02-01',
      },
      resume: { plaque: 'FR 4711', designation: 'Opel Corsa 1.2', detenteurNom: 'Rossi Maria' },
    };
    render(<ResultatVehicule resultat={resultatHistorique} />);
    const mention = screen.getByRole('note');
    expect(mention).toHaveTextContent("Ancienne plaque de Rossi Maria jusqu'au 01.02.2025");
  });

  it("n'a aucune mention historique pour le véhicule courant", () => {
    render(<ResultatVehicule resultat={RESULTAT_VEHICULE_COURANT} />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
