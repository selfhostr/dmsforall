import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { BadgeEcheanceExpertise } from './BadgeEcheanceExpertise';

describe('BadgeEcheanceExpertise', () => {
  afterEach(async () => {
    vi.useRealTimers();
    await i18n.changeLanguage('fr');
  });

  it('rend « Échue » et la date absolue quand l’échéance est dépassée', () => {
    render(<BadgeEcheanceExpertise prochaineLe="2026-01-15" echue />);
    expect(screen.getByText(/Échue/)).toBeInTheDocument();
    expect(screen.getByText(/15\.01\.2026/)).toBeInTheDocument();
  });

  it('accompagne toujours le relatif de la date absolue (invariant n°5 : jamais le relatif seul)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'));
    render(<BadgeEcheanceExpertise prochaineLe="2026-08-01" echue={false} />);
    expect(screen.getByText(/mois/)).toBeInTheDocument();
    expect(screen.getByText(/01\.08\.2026/)).toBeInTheDocument();
  });

  it('ne rend rien sans échéance connue', () => {
    const { container } = render(<BadgeEcheanceExpertise prochaineLe={null} echue={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('traduit « Échue » en allemand', async () => {
    await i18n.changeLanguage('de');
    render(<BadgeEcheanceExpertise prochaineLe="2026-01-15" echue />);
    expect(screen.getByText(/Abgelaufen/)).toBeInTheDocument();
  });
});
