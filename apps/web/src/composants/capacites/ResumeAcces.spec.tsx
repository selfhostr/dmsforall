import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { capacitesDuPrereglage } from './modele-test';
import { ResumeAcces } from './ResumeAcces';

describe('ResumeAcces', () => {
  it('résume les domaines où la personne agit, l’encadrement et le préréglage', () => {
    render(<ResumeAcces capacites={capacitesDuPrereglage('chef_atelier')} />);
    expect(screen.getByText('Atelier, Accueil, Facturation, Pièces · encadre')).toBeInTheDocument();
    expect(
      screen.getByText(i18n.t('capacites:prereglages.chef_atelier.libelle')),
    ).toBeInTheDocument();
  });

  it('une grille qui ne fait que regarder se lit « Lecture seule »', () => {
    render(<ResumeAcces capacites={capacitesDuPrereglage('fiduciaire')} />);
    expect(screen.getByText('Lecture seule')).toBeInTheDocument();
    expect(screen.getByText('Voit : Facturation, Finances')).toBeInTheDocument();
  });

  it('une grille personnalisée porte le badge « Personnalisé »', () => {
    render(
      <ResumeAcces
        capacites={{
          ...capacitesDuPrereglage('technicien'),
          prereglage: null,
          personnalisee: true,
        }}
      />,
    );
    expect(screen.getByText('Personnalisé')).toBeInTheDocument();
  });
});
