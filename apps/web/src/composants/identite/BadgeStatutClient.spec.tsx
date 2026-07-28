import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { BadgeStatutClient } from './BadgeStatutClient';

describe('BadgeStatutClient', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('rend le mot pour chacun des trois statuts (mapping exhaustif)', () => {
    render(<BadgeStatutClient statut="actif" />);
    expect(screen.getByText('Actif')).toBeInTheDocument();
  });

  it('rend « Bloqué » avec un poids visuel distinct pour un client bloqué', () => {
    render(<BadgeStatutClient statut="bloque" />);
    const badge = screen.getByText('Bloqué');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('font-semibold');
  });

  it('traduit le libellé en allemand', async () => {
    await i18n.changeLanguage('de');
    render(<BadgeStatutClient statut="bloque" />);
    expect(screen.getByText('Gesperrt')).toBeInTheDocument();
  });
});
