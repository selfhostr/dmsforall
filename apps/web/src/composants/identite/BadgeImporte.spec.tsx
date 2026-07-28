import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { BadgeImporte } from './BadgeImporte';

const IMPORTE = { estImporte: true, paysOrigine: 'DE', importeLe: '2020-01-10' };
const NON_IMPORTE = { estImporte: false, paysOrigine: null, importeLe: null };

describe('BadgeImporte', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('rend le mot « Importé » pour un véhicule importé', () => {
    render(<BadgeImporte importation={IMPORTE} />);
    expect(screen.getByText('Importé')).toBeInTheDocument();
  });

  it("ne rend rien pour un véhicule d'origine suisse", () => {
    const { container } = render(<BadgeImporte importation={NON_IMPORTE} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('traduit le libellé en allemand', async () => {
    await i18n.changeLanguage('de');
    render(<BadgeImporte importation={IMPORTE} />);
    expect(screen.getByText('Importiert')).toBeInTheDocument();
  });
});
