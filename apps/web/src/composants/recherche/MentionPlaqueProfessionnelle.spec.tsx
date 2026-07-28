import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { MentionPlaqueProfessionnelle } from './MentionPlaqueProfessionnelle';

describe('MentionPlaqueProfessionnelle', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('signale la plaque professionnelle (U)', () => {
    render(<MentionPlaqueProfessionnelle />);
    expect(screen.getByText('Plaque du garage (U)')).toBeInTheDocument();
  });

  it('traduit la mention en allemand', async () => {
    await i18n.changeLanguage('de');
    render(<MentionPlaqueProfessionnelle />);
    expect(screen.getByText('Werkstatt-Kennzeichen (U)')).toBeInTheDocument();
  });
});
