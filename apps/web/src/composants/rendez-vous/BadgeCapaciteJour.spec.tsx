import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { BadgeCapaciteJour } from './BadgeCapaciteJour';

describe('BadgeCapaciteJour', () => {
  it('affiche l’occupation, la marge encore libre et le mot "Disponible" quand la marge est large', () => {
    render(<BadgeCapaciteJour nombreRendezVous={2} minutesOccupees={120} capaciteMinutes={480} />);
    expect(screen.getByText('2h00 occupée sur 8h00 — encore 6h00 libres')).toBeInTheDocument();
    expect(screen.getByText(/Disponible/)).toBeInTheDocument();
  });

  it('affiche "Presque complet" avec la marge restante (jamais un triangle sur une journée vide)', () => {
    render(<BadgeCapaciteJour nombreRendezVous={5} minutesOccupees={460} capaciteMinutes={480} />);
    expect(screen.getByText('7h40 occupée sur 8h00 — encore 0h20 libres')).toBeInTheDocument();
    expect(screen.getByText(/Presque complet/)).toBeInTheDocument();
  });

  it('affiche "Complet" sans marge restante (redondant avec le mot) quand l’occupation atteint ou dépasse la capacité (surbooking)', () => {
    render(<BadgeCapaciteJour nombreRendezVous={9} minutesOccupees={510} capaciteMinutes={480} />);
    expect(screen.getByText('8h30 occupée sur 8h00')).toBeInTheDocument();
    expect(screen.getByText(/Complet/)).toBeInTheDocument();
  });

  it('n’affiche jamais l’état "Presque complet"/triangle sur une journée totalement vide', () => {
    render(<BadgeCapaciteJour nombreRendezVous={0} minutesOccupees={0} capaciteMinutes={480} />);
    expect(screen.getByText('0h00 occupée sur 8h00 — encore 8h00 libres')).toBeInTheDocument();
    expect(screen.getByText(/Disponible/)).toBeInTheDocument();
    expect(screen.queryByText(/Presque complet/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Complet/)).not.toBeInTheDocument();
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

  // `niveauDetail="resume"` — vue Semaine (sept pastilles côte à côte) : le mot d'état reste
  // toujours affiché (jamais la seule couleur), mais la phrase complète occupé/capacité disparaît
  // au profit de la seule marge encore libre — c'est elle qui répond à « puis-je encore prendre un
  // client ce jour-là ? ».
  describe('niveauDetail="resume" (vue Semaine)', () => {
    it('affiche le mot d’état ET la marge encore libre, jamais la phrase complète occupé/capacité', () => {
      render(
        <BadgeCapaciteJour
          nombreRendezVous={2}
          minutesOccupees={120}
          capaciteMinutes={480}
          niveauDetail="resume"
        />,
      );
      expect(screen.getByText(/Disponible/)).toBeInTheDocument();
      expect(screen.getByText('encore 6h00 libres')).toBeInTheDocument();
      expect(
        screen.queryByText('2h00 occupée sur 8h00 — encore 6h00 libres'),
      ).not.toBeInTheDocument();
    });

    it('n’affiche qu’un seul mot pour un jour complet — jamais une marge à "encore 0h00 libres"', () => {
      render(
        <BadgeCapaciteJour
          nombreRendezVous={9}
          minutesOccupees={510}
          capaciteMinutes={480}
          niveauDetail="resume"
        />,
      );
      expect(screen.getByText(/Complet/)).toBeInTheDocument();
      expect(screen.queryByText(/libres/)).not.toBeInTheDocument();
      expect(screen.queryByText(/occupée/)).not.toBeInTheDocument();
    });

    it('affiche le compte brut et jamais "disponible"/"complet" pour une capacité non définie', () => {
      render(
        <BadgeCapaciteJour
          nombreRendezVous={5}
          minutesOccupees={180}
          capaciteMinutes={null}
          niveauDetail="resume"
        />,
      );
      expect(screen.getByText('5 rendez-vous')).toBeInTheDocument();
      expect(screen.getByText(/Capacité non définie/)).toBeInTheDocument();
      expect(screen.queryByText(/Disponible/)).not.toBeInTheDocument();
    });

    it('porte la phrase complète en infobulle (survol) même en résumé', () => {
      const { container } = render(
        <BadgeCapaciteJour
          nombreRendezVous={2}
          minutesOccupees={120}
          capaciteMinutes={480}
          niveauDetail="resume"
        />,
      );
      const infobulle = container.querySelector('[title]');
      expect(infobulle?.getAttribute('title')).toContain(
        '2h00 occupée sur 8h00 — encore 6h00 libres',
      );
    });
  });
});
