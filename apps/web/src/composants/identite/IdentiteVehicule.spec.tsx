import type { VehiculeResume } from '@dfa/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { IdentiteVehicule } from './IdentiteVehicule';

const VEHICULE: VehiculeResume = {
  id: 'v1',
  // Forme réelle servie par l'API : `plaque` porte déjà le canton en préfixe
  // (`VehiculeResume.plaque` / `ReponseVehiculePlaque.valeur`), `canton` est redondant.
  plaque: 'VD 123456',
  canton: 'VD',
  designation: 'VW Touran 2.0 TDI',
  vin: 'WVGZZZ1TZ8W123456',
  premiereMiseEnCirculationLe: '2018-03-14',
  identificationIncomplete: false,
  emplacementLibre: null,
};

describe('IdentiteVehicule', () => {
  it('affiche plaque, désignation et année dans le format unique du produit', () => {
    render(<IdentiteVehicule vehicule={VEHICULE} />);
    expect(screen.getByText('VD')).toBeInTheDocument();
    expect(screen.getByText('123456')).toBeInTheDocument();
    expect(screen.getByText('VW Touran 2.0 TDI')).toBeInTheDocument();
    expect(screen.getByText('2018')).toBeInTheDocument();
  });

  it('ne double jamais le canton dans la plaque (régression)', () => {
    render(<IdentiteVehicule vehicule={VEHICULE} />);
    expect(screen.queryByText('VD VD 123456')).not.toBeInTheDocument();
    expect(screen.queryByText('VD 123456')).not.toBeInTheDocument();
  });

  it("n'affiche pas d'année quand la date de première mise en circulation est inconnue", () => {
    render(<IdentiteVehicule vehicule={{ ...VEHICULE, premiereMiseEnCirculationLe: null }} />);
    expect(screen.queryByText('2018')).not.toBeInTheDocument();
  });

  it('intègre le badge identification incomplète quand le VIN est absent (RM-16)', () => {
    render(<IdentiteVehicule vehicule={{ ...VEHICULE, identificationIncomplete: true }} />);
    expect(screen.getByText('Numéro de châssis manquant')).toBeInTheDocument();
  });
});
