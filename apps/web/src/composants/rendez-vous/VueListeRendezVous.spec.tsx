import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { VueListeRendezVous } from './VueListeRendezVous';
import type { RendezVousCarte } from './types';

function construireRendezVous(overrides: Partial<RendezVousCarte> = {}): RendezVousCarte {
  return {
    id: 'rdv-1',
    dateLe: '2026-08-13',
    moment: 'matin',
    heureSouhaitee: '09:00:00',
    dureeEstimeeMinutes: 30,
    clientNom: 'Jean Dupont',
    vehiculePlaque: 'VS 123456',
    vehiculeCanton: 'VS',
    vehiculeDesignation: 'VW Golf',
    motifLibelle: 'Entretien / service courant',
    statut: 'confirme',
    ...overrides,
  };
}

describe('VueListeRendezVous', () => {
  it('affiche une ligne par rendez-vous, accessible au clavier', async () => {
    const utilisateur = userEvent.setup();
    const onOuvrir = vi.fn();
    const rendezVous = construireRendezVous();
    render(<VueListeRendezVous rendezVous={[rendezVous]} onOuvrirRendezVous={onOuvrir} />);
    expect(screen.getByText('Jean Dupont')).toBeInTheDocument();
    expect(screen.getByText('Entretien / service courant')).toBeInTheDocument();
    expect(screen.getByText('Confirmé')).toBeInTheDocument();
    const ligne = screen.getByRole('link');
    ligne.focus();
    await utilisateur.keyboard('{Enter}');
    expect(onOuvrir).toHaveBeenCalledWith(rendezVous);
  });

  it('affiche le moment quand aucune heure souhaitée n’est connue', () => {
    render(
      <VueListeRendezVous
        rendezVous={[construireRendezVous({ heureSouhaitee: null, moment: 'apres_midi' })]}
        onOuvrirRendezVous={vi.fn()}
      />,
    );
    expect(screen.getByText(/Après-midi/)).toBeInTheDocument();
  });

  it('rend le contenu vide fourni quand aucun rendez-vous', () => {
    render(
      <VueListeRendezVous
        rendezVous={[]}
        onOuvrirRendezVous={vi.fn()}
        contenuVide={<p>Rien ici</p>}
      />,
    );
    expect(screen.getByText('Rien ici')).toBeInTheDocument();
  });
});
