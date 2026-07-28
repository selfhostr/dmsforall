import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { BadgeLangueCorrespondance } from './BadgeLangueCorrespondance';

describe('BadgeLangueCorrespondance', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('rend le drapeau et le mot pour chacune des trois langues (mapping exhaustif)', () => {
    render(<BadgeLangueCorrespondance langue="de" />);
    expect(screen.getByText('Deutsch')).toBeInTheDocument();
  });

  it('le mot vient bien du namespace commun (endonyme, indépendant de la langue d’interface)', async () => {
    await i18n.changeLanguage('de');
    render(<BadgeLangueCorrespondance langue="it" />);
    // `commun:langues.*` conserve les endonymes (« Italiano ») quelle que soit la langue
    // d'interface — voir apps/web/src/i18n/locales/{fr,de,it}/commun.json.
    expect(screen.getByText('Italiano')).toBeInTheDocument();
  });
});
