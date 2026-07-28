import type { ResultatRecherche } from '@dfa/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { ChoixPlaqueInterchangeable } from './ChoixPlaqueInterchangeable';

const VEHICULE_A: ResultatRecherche = {
  type: 'vehicule',
  id: 'va',
  score: 0.7,
  correspondance: { champ: 'plaque', valeur: 'VD 123456', historique: false },
  resume: { plaque: 'VD 123456', designation: 'VW Touran 2.0 TDI' },
};

const VEHICULE_B: ResultatRecherche = {
  type: 'vehicule',
  id: 'vb',
  score: 0.7,
  correspondance: { champ: 'plaque', valeur: 'VD 123456', historique: false },
  resume: { plaque: 'VD 123456', designation: 'Skoda Octavia' },
};

describe('ChoixPlaqueInterchangeable', () => {
  it('affiche les DEUX véhicules et pose une question, sans en présélectionner un (RM-18)', () => {
    render(<ChoixPlaqueInterchangeable vehicules={[VEHICULE_A, VEHICULE_B]} onChoisir={vi.fn()} />);
    expect(screen.getByText(/VW Touran 2\.0 TDI/)).toBeInTheDocument();
    expect(screen.getByText(/Skoda Octavia/)).toBeInTheDocument();

    const boutons = screen.getAllByRole('button');
    expect(boutons).toHaveLength(2);
    // Poids visuel strictement identique : même classe, aucun `aria-selected`/`data-selected`.
    expect(boutons[0]!.className).toBe(boutons[1]!.className);
    for (const bouton of boutons) {
      expect(bouton).not.toHaveAttribute('aria-selected');
      expect(bouton).not.toHaveAttribute('data-selected');
      expect(bouton).not.toHaveFocus();
    }
  });

  it('transmet le véhicule choisi au clic, jamais un choix implicite', async () => {
    const onChoisir = vi.fn();
    const utilisateur = userEvent.setup();
    render(<ChoixPlaqueInterchangeable vehicules={[VEHICULE_A, VEHICULE_B]} onChoisir={onChoisir} />);
    await utilisateur.click(screen.getByText(/Skoda Octavia/));
    expect(onChoisir).toHaveBeenCalledTimes(1);
    expect(onChoisir).toHaveBeenCalledWith(VEHICULE_B);
  });
});
