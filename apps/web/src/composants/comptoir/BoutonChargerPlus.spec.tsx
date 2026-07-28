import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { BoutonChargerPlus } from './BoutonChargerPlus';

describe('BoutonChargerPlus', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('ne rend rien en fin de liste (aChargerPlus = false)', () => {
    const { container } = render(<BoutonChargerPlus aChargerPlus={false} onChargerPlus={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('appelle onChargerPlus au clic', async () => {
    const onChargerPlus = vi.fn();
    const utilisateur = userEvent.setup();
    render(<BoutonChargerPlus aChargerPlus onChargerPlus={onChargerPlus} />);

    await utilisateur.click(screen.getByRole('button', { name: 'Charger plus' }));
    expect(onChargerPlus).toHaveBeenCalled();
  });

  it('se désactive pendant le chargement', () => {
    render(<BoutonChargerPlus aChargerPlus enChargement onChargerPlus={vi.fn()} />);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('traduit le libellé en allemand', async () => {
    await i18n.changeLanguage('de');
    render(<BoutonChargerPlus aChargerPlus onChargerPlus={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Mehr laden' })).toBeInTheDocument();
  });
});
