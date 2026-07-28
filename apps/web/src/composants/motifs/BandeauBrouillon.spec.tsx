import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { BandeauBrouillon } from './BandeauBrouillon';

describe('BandeauBrouillon', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('affiche l’heure de reprise du brouillon, format suisse HH:MM', () => {
    render(<BandeauBrouillon repriseLe="2026-07-27T07:12:00.000Z" />);
    expect(screen.getByText(/Brouillon repris de/)).toBeInTheDocument();
  });

  it('traduit le libellé en allemand', async () => {
    await i18n.changeLanguage('de');
    render(<BandeauBrouillon repriseLe="2026-07-27T07:12:00.000Z" />);
    expect(screen.getByText(/Entwurf von/)).toBeInTheDocument();
  });
});
