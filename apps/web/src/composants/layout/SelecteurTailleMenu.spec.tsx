import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import '@/i18n';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CLE_STOCKAGE_DENSITE } from '@/hooks/useDensite';

import { SelecteurTailleMenu } from './SelecteurTailleMenu';

async function ouvrir() {
  const utilisateur = userEvent.setup();
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>Compte</DropdownMenuTrigger>
      <DropdownMenuContent>
        <SelecteurTailleMenu />
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  await utilisateur.click(screen.getByRole('button', { name: 'Compte' }));
  return utilisateur;
}

beforeEach(() => window.localStorage.removeItem(CLE_STOCKAGE_DENSITE));

describe('SelecteurTailleMenu', () => {
  it('trois options nommées, groupe étiqueté, « Automatique » coché par défaut', async () => {
    await ouvrir();

    expect(screen.getByRole('group', { name: /taille de l.interface/i })).toBeInTheDocument();
    const options = screen.getAllByRole('menuitemradio');
    expect(options.map((o) => o.getAttribute('aria-label'))).toEqual([
      "Automatique (selon l'appareil)",
      'Compacte',
      'Aérée',
    ]);
    expect(options.map((o) => o.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
  });

  it('un clic choisit la taille, la mémorise et laisse le menu ouvert', async () => {
    const utilisateur = await ouvrir();

    await utilisateur.click(screen.getByRole('menuitemradio', { name: 'Aérée' }));

    expect(window.localStorage.getItem(CLE_STOCKAGE_DENSITE)).toBe('aeree');
    expect(screen.getByRole('menuitemradio', { name: 'Aérée' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemradio', { name: /automatique/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('au clavier : flèches puis Entrée choisissent « Compacte »', async () => {
    const utilisateur = await ouvrir();

    const auto = screen.getByRole('menuitemradio', { name: /automatique/i });
    auto.focus();
    await utilisateur.keyboard('{ArrowDown}{Enter}');

    expect(window.localStorage.getItem(CLE_STOCKAGE_DENSITE)).toBe('compacte');
    expect(screen.getByRole('menuitemradio', { name: 'Compacte' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
