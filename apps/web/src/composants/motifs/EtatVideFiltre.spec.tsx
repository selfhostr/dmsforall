import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { EtatVideFiltre } from './EtatVideFiltre';

describe('EtatVideFiltre', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('ajoute automatiquement l’action « Effacer les filtres » quand `onEffacerFiltres` est fourni', async () => {
    const utilisateur = userEvent.setup();
    const onEffacerFiltres = vi.fn();
    render(
      <EtatVideFiltre
        titre="Aucun résultat avec ces filtres."
        description="Modifiez ou effacez les filtres actifs."
        onEffacerFiltres={onEffacerFiltres}
      />,
    );

    const bouton = screen.getByRole('button', { name: 'Effacer les filtres' });
    await utilisateur.click(bouton);
    expect(onEffacerFiltres).toHaveBeenCalledTimes(1);
  });

  it("n'affiche aucune action quand `onEffacerFiltres` est omis", () => {
    render(<EtatVideFiltre titre="Aucun résultat avec ces filtres." description="—" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('traduit le bouton en allemand', async () => {
    await i18n.changeLanguage('de');
    render(
      <EtatVideFiltre
        titre="Aucun résultat avec ces filtres."
        description="—"
        onEffacerFiltres={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Filter löschen' })).toBeInTheDocument();
  });
});
