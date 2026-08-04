import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EtatVideRecherche } from './EtatVideRecherche';

describe('EtatVideRecherche', () => {
  it('affiche le titre et la description sans action par défaut', () => {
    render(
      <EtatVideRecherche titre="Aucun client trouvé." description="Essayez une autre recherche." />,
    );
    expect(screen.getByText('Aucun client trouvé.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
