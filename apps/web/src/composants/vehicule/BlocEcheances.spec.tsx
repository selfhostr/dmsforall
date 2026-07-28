import type { GarantieVehicule, ReponseContexteAtelier } from '@dfa/shared';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { BlocEcheances } from './BlocEcheances';

const GARANTIE_ACTIVE: GarantieVehicule = {
  debutLe: '2024-01-01',
  finLe: '2027-01-01',
  plafondKm: 100000,
  active: true,
};

const EXPERTISE_CONVOCATION: ReponseContexteAtelier['expertise'] = {
  derniereLe: '2022-05-01',
  prochaineLe: '2026-08-01',
  source: 'convocation',
  echue: false,
  joursDepuisEcheance: null,
};

describe('BlocEcheances', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it("affiche toujours la source de l'échéance d'expertise (RM-28)", () => {
    render(
      <BlocEcheances expertise={EXPERTISE_CONVOCATION} garantieConstructeur={null} garantieGarage={null} />,
    );
    expect(screen.getByText(/Convocation/)).toBeInTheDocument();
  });

  it('signale une expertise échue de façon visible', () => {
    render(
      <BlocEcheances
        expertise={{ ...EXPERTISE_CONVOCATION, echue: true }}
        garantieConstructeur={null}
        garantieGarage={null}
      />,
    );
    // « Échue » apparaît aussi côté garantie (absente ici) : on scope sur la ligne de date.
    const ligneDate = screen.getByText(/01\.08\.2026/).closest('p');
    expect(ligneDate).not.toBeNull();
    expect(ligneDate).toHaveTextContent('Échue');
  });

  it('affiche la date de fin ET le plafond kilométrique de la garantie ensemble (RM-33)', () => {
    render(
      <BlocEcheances expertise={null} garantieConstructeur={GARANTIE_ACTIVE} garantieGarage={null} />,
    );
    expect(screen.getByText(/01\.01\.2027/)).toBeInTheDocument();
    expect(screen.getByText(/100'000 km/)).toBeInTheDocument();
  });

  it('traduit le libellé de source en allemand', async () => {
    await i18n.changeLanguage('de');
    render(
      <BlocEcheances expertise={EXPERTISE_CONVOCATION} garantieConstructeur={null} garantieGarage={null} />,
    );
    expect(screen.getByText(/Vorladung/)).toBeInTheDocument();
  });
});
