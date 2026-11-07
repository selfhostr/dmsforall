import type { ReponseTravailReporte } from '@dfa/shared';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { ListeTravauxReportes } from './ListeTravauxReportes';

const TRAVAIL: ReponseTravailReporte = {
  id: 't1',
  designation: 'Plaquettes de frein avant à surveiller',
  urgence: 'urgent',
  montantEstimeCentimes: 24000,
  kilometrageAlors: 85000,
  constateLe: '2026-01-15',
  securite: true,
  statut: 'ouvert',
  ordreReparationOrigineId: 'or1',
  ligneOrOrigineId: 'l1',
  ordreReparationRepriseId: null,
  motifModification: null,
  detail: null,
};

describe('ListeTravauxReportes', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it("affiche le montant de l'époque et le kilométrage d'alors, jamais recalculés", () => {
    render(<ListeTravauxReportes travaux={[TRAVAIL]} />);
    expect(screen.getByText(/240\.00/)).toBeInTheDocument();
    expect(screen.getByText(/85'000 km/)).toBeInTheDocument();
    expect(screen.getByText('Plaquettes de frein avant à surveiller')).toBeInTheDocument();
  });

  it("n'affiche aucun montant quand le rôle n'y a pas droit (champ absent)", () => {
    const { montantEstimeCentimes: _ignore, ...sansMontant } = TRAVAIL;
    render(<ListeTravauxReportes travaux={[sansMontant]} />);
    expect(screen.queryByText(/CHF|\.00/)).not.toBeInTheDocument();
  });

  it('affiche un état vide dédié (pas une grille de champs vides) quand il n’y a aucun travail reporté', () => {
    render(<ListeTravauxReportes travaux={[]} />);
    // Le titre de carte ET le titre de l'état vide portent le même libellé : deux occurrences.
    expect(screen.getAllByText('Travaux reportés')).toHaveLength(2);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('traduit le niveau d’urgence en allemand', async () => {
    await i18n.changeLanguage('de');
    render(<ListeTravauxReportes travaux={[TRAVAIL]} />);
    expect(screen.getByText('Dringend')).toBeInTheDocument();
  });
});
