import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { BadgeTypeClient } from './BadgeTypeClient';

describe('BadgeTypeClient', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('rend « Particulier » pour un client particulier', () => {
    render(<BadgeTypeClient type="particulier" />);
    expect(screen.getByText('Particulier')).toBeInTheDocument();
  });

  it('rend « Entreprise » pour un client entreprise', () => {
    render(<BadgeTypeClient type="entreprise" />);
    expect(screen.getByText('Entreprise')).toBeInTheDocument();
  });

  it('traduit le libellé en allemand', async () => {
    await i18n.changeLanguage('de');
    render(<BadgeTypeClient type="entreprise" />);
    expect(screen.getByText('Unternehmen')).toBeInTheDocument();
  });
});
