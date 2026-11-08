import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { BadgeStatutLigneOr } from './BadgeStatutLigneOr';

describe('BadgeStatutLigneOr', () => {
  it.each([
    ['proposee', 'Proposée'],
    ['a_valider', 'À valider'],
    ['annulee', 'Annulée'],
  ] as const)('affiche le mot du statut %s avec une icône', (statut, mot) => {
    const { container } = render(<BadgeStatutLigneOr statut={statut} />);
    expect(screen.getByText(mot)).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
