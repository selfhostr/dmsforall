import type { ElementBloquant } from '@dfa/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { ListeElementsBloquants } from './ListeElementsBloquants';

const ELEMENTS: readonly ElementBloquant[] = [
  {
    type: 'ligne_or',
    id: 'l1',
    libelle: 'Disques de frein avant (jeu)',
    donnees: { numeroLigne: 4, totalTtcCentimes: 62000, origine: 'constatee' },
  },
  { type: 'champ', id: 'motifReport', libelle: 'Motif de report' },
];

describe('ListeElementsBloquants', () => {
  it('rend une ligne cliquable par élément, jamais le `libelle` serveur', () => {
    render(<ListeElementsBloquants blocages={ELEMENTS} />);

    const boutons = screen.getAllByRole('button');
    expect(boutons).toHaveLength(2);
    expect(screen.queryByText('Disques de frein avant (jeu)')).not.toBeInTheDocument();
    expect(screen.queryByText('Motif de report')).not.toBeInTheDocument();
  });

  it('enrichit la ligne « ligne_or » avec le numéro, l’origine et le montant tirés de `donnees`', () => {
    render(<ListeElementsBloquants blocages={ELEMENTS} />);
    expect(screen.getByText(/#4/)).toBeInTheDocument();
    expect(screen.getByText(/Découvert pendant l'intervention/)).toBeInTheDocument();
    expect(screen.getByText(/620\.00/)).toBeInTheDocument();
  });

  it('affiche le nom du champ pour un élément de type « champ » (seul cas où `id` est la donnée d’affichage)', () => {
    render(<ListeElementsBloquants blocages={ELEMENTS} />);
    expect(screen.getByText(/motifReport/)).toBeInTheDocument();
  });

  it('ne rend rien sans blocage', () => {
    const { container } = render(<ListeElementsBloquants blocages={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
