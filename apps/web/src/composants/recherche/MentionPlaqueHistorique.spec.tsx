import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { MentionPlaqueHistorique } from './MentionPlaqueHistorique';

describe('MentionPlaqueHistorique', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('porte le rôle ARIA "note" — distinction sémantique, pas seulement visuelle', () => {
    render(<MentionPlaqueHistorique nomClient="Rossi Maria" porteeJusquLe="2025-02-01" />);
    expect(screen.getByRole('note')).toHaveTextContent("Ancienne plaque de Rossi Maria jusqu'au 01.02.2025");
  });

  it('traduit la mention en allemand', async () => {
    await i18n.changeLanguage('de');
    render(<MentionPlaqueHistorique nomClient="Rossi Maria" porteeJusquLe="2025-02-01" />);
    expect(screen.getByRole('note')).toHaveTextContent('Früheres Kennzeichen von Rossi Maria bis 01.02.2025');
  });
});
