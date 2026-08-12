import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { BadgeCapaciteJour } from './BadgeCapaciteJour';

describe('BadgeCapaciteJour', () => {
  it('affiche l’occupation en heures et le mot "Disponible" quand la marge est large', () => {
    render(<BadgeCapaciteJour nombreRendezVous={2} minutesOccupees={120} capaciteMinutes={480} />);
    expect(screen.getByText('2h00 / 8h00')).toBeInTheDocument();
    expect(screen.getByText(/Disponible/)).toBeInTheDocument();
  });

  it('affiche "Presque complet" quand la marge restante est faible', () => {
    render(<BadgeCapaciteJour nombreRendezVous={5} minutesOccupees={460} capaciteMinutes={480} />);
    expect(screen.getByText(/Presque complet/)).toBeInTheDocument();
  });

  it('affiche "Complet" quand l’occupation atteint ou dépasse la capacité (surbooking)', () => {
    render(<BadgeCapaciteJour nombreRendezVous={9} minutesOccupees={510} capaciteMinutes={480} />);
    expect(screen.getByText(/Complet/)).toBeInTheDocument();
  });

  it('n’affiche JAMAIS "disponible"/"complet" quand la capacité est non définie — seulement le compte brut', () => {
    render(<BadgeCapaciteJour nombreRendezVous={5} minutesOccupees={180} capaciteMinutes={null} />);
    expect(screen.getByText('5 rendez-vous')).toBeInTheDocument();
    expect(screen.queryByText(/Disponible/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Complet/)).not.toBeInTheDocument();
    expect(screen.getByText(/Capacité non définie/)).toBeInTheDocument();
  });

  it('ne rend jamais "0 rendez-vous, disponible" pour une capacité non définie à zéro occupation', () => {
    render(<BadgeCapaciteJour nombreRendezVous={0} minutesOccupees={0} capaciteMinutes={null} />);
    expect(screen.getByText('0 rendez-vous')).toBeInTheDocument();
    expect(screen.queryByText(/Disponible/)).not.toBeInTheDocument();
  });
});
