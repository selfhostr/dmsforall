import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EtatVidePremierUsage } from './EtatVidePremierUsage';

describe('EtatVidePremierUsage', () => {
  it('affiche le titre, la description et l’action de création transmis par l’écran', () => {
    render(
      <EtatVidePremierUsage
        titre="Aucun client enregistré. Créez le premier."
        description="Commencez par créer votre premier client."
        action={<button type="button">Nouveau client</button>}
      />,
    );
    expect(screen.getByText('Aucun client enregistré. Créez le premier.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nouveau client' })).toBeInTheDocument();
  });
});
