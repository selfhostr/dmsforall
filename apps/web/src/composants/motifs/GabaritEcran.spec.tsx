import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { GabaritEcran } from './GabaritEcran';

describe('GabaritEcran', () => {
  it('rend le titre comme unique niveau 1, visible par défaut', () => {
    render(
      <GabaritEcran titre="Clients">
        <p>Contenu</p>
      </GabaritEcran>,
    );
    const titre = screen.getByRole('heading', { level: 1, name: 'Clients' });
    expect(titre).toBeInTheDocument();
    expect(titre).not.toHaveClass('sr-only');
  });

  it('garde le h1 dans le DOM mais visuellement masqué quand `titreVisible` est faux', () => {
    render(
      <GabaritEcran titre="Articles" titreVisible={false}>
        <p>Contenu</p>
      </GabaritEcran>,
    );
    const titre = screen.getByRole('heading', { level: 1, name: 'Articles' });
    expect(titre).toHaveClass('sr-only');
  });

  it('rend les actions à droite du titre quand elles sont fournies', () => {
    render(
      <GabaritEcran titre="Clients" actions={<button type="button">Nouveau client</button>}>
        <p>Contenu</p>
      </GabaritEcran>,
    );
    expect(screen.getByRole('button', { name: 'Nouveau client' })).toBeInTheDocument();
  });

  it("n'ajoute aucun padding ni largeur maximale : pleine largeur, un seul espacement", () => {
    const { container } = render(
      <GabaritEcran titre="Comptoir">
        <p>Contenu</p>
      </GabaritEcran>,
    );
    const racine = container.firstElementChild;
    expect(racine).toHaveClass('w-full');
    expect(racine?.className).not.toMatch(/\bp-\d/);
    expect(racine?.className).not.toMatch(/max-w-/);
  });

  it('rend les enfants après le titre', () => {
    render(
      <GabaritEcran titre="Clients">
        <p>Barre de filtres puis tableau</p>
      </GabaritEcran>,
    );
    expect(screen.getByText('Barre de filtres puis tableau')).toBeInTheDocument();
  });
});
