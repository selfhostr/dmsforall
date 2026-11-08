import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { AideContextuelle } from './AideContextuelle';

function rendre() {
  return render(
    <p>
      Libellé <AideContextuelle sujet="MFK" texte="Contrôle technique officiel du véhicule." />
    </p>,
  );
}

describe('AideContextuelle', () => {
  it('réserve 16 px en permanence : le bouton ne change pas de gabarit à l’ouverture', async () => {
    rendre();
    const bouton = await screen.findByRole('button', { name: /MFK/ });
    expect(bouton.className).toContain('size-4');
    expect(bouton.className).toContain('shrink-0');
    await userEvent.click(bouton);
    expect(await screen.findByText(/Contrôle technique officiel/)).toBeInTheDocument();
    expect(bouton.className).toContain('size-4');
  });

  it('s’ouvre au clic et se ferme avec Échap', async () => {
    rendre();
    await userEvent.click(await screen.findByRole('button', { name: /MFK/ }));
    expect(await screen.findByText(/Contrôle technique officiel/)).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByText(/Contrôle technique officiel/)).not.toBeInTheDocument();
  });

  it('s’ouvre au clavier (Entrée) sur le bouton focusé', async () => {
    rendre();
    const bouton = await screen.findByRole('button', { name: /MFK/ });
    await userEvent.tab();
    expect(bouton).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByText(/Contrôle technique officiel/)).toBeInTheDocument();
  });

  it('s’ouvre au survol', async () => {
    rendre();
    await userEvent.hover(await screen.findByRole('button', { name: /MFK/ }));
    expect(await screen.findByText(/Contrôle technique officiel/)).toBeInTheDocument();
  });
});
