import { STATUTS_RDV } from '@dfa/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { BadgeStatutRendezVous } from './BadgeStatutRendezVous';

describe('BadgeStatutRendezVous', () => {
  it.each(STATUTS_RDV)('rend un mot traduit pour le statut "%s"', (statut) => {
    render(<BadgeStatutRendezVous statut={statut} />);
    expect(screen.getByText(/./)).toBeInTheDocument();
  });

  it('rend "Arrivé" pour le statut serveur "honore" (vocabulaire d’écran, jamais le mot technique)', () => {
    render(<BadgeStatutRendezVous statut="honore" />);
    expect(screen.getByText('Arrivé')).toBeInTheDocument();
    expect(screen.queryByText(/honoré/i)).not.toBeInTheDocument();
  });

  it('distingue Client absent et Annulé par un mot différent malgré le même token de couleur', () => {
    const { unmount } = render(<BadgeStatutRendezVous statut="absent" />);
    expect(screen.getByText('Client absent')).toBeInTheDocument();
    unmount();
    render(<BadgeStatutRendezVous statut="annule" />);
    expect(screen.getByText('Annulé')).toBeInTheDocument();
  });
});
