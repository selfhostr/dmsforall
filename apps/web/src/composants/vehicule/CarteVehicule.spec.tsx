import type { VehiculeResume } from '@dfa/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { CarteVehicule } from './CarteVehicule';

const VEHICULE: VehiculeResume = {
  id: 'v1',
  plaque: '123456',
  canton: 'VD',
  designation: 'VW Touran 2.0 TDI',
  vin: 'WVGZZZ1TZ8W123456',
  premiereMiseEnCirculationLe: '2018-03-14',
  identificationIncomplete: false,
};

describe('CarteVehicule', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it("compose l'identité véhicule (invariant n°1) et le VIN copiable", () => {
    render(<CarteVehicule vehicule={VEHICULE} />);
    expect(screen.getByText('VD')).toBeInTheDocument();
    expect(screen.getByText('123456')).toBeInTheDocument();
    expect(screen.getByText('VW Touran 2.0 TDI')).toBeInTheDocument();
    expect(screen.getByText('WVGZZZ1TZ8W123456')).toBeInTheDocument();
  });

  it("n'est pas cliquable sans onOuvrir", () => {
    render(<CarteVehicule vehicule={VEHICULE} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('appelle onOuvrir au clic et à Entrée quand fourni', async () => {
    const onOuvrir = vi.fn();
    const utilisateur = userEvent.setup();
    render(<CarteVehicule vehicule={VEHICULE} onOuvrir={onOuvrir} />);
    const carte = screen.getByRole('link');
    await utilisateur.click(carte);
    expect(onOuvrir).toHaveBeenCalledTimes(1);
    carte.focus();
    await utilisateur.keyboard('{Enter}');
    expect(onOuvrir).toHaveBeenCalledTimes(2);
  });

  it('affiche le badge identification incomplète (RM-16), traduit en allemand', async () => {
    await i18n.changeLanguage('de');
    render(<CarteVehicule vehicule={{ ...VEHICULE, identificationIncomplete: true }} />);
    expect(
      screen.getByText('Identifikation unvollständig'),
    ).toBeInTheDocument();
  });
});
