import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SelecteurTri } from './SelecteurTri';

const OPTIONS = [
  { valeur: 'nom:asc', libelle: 'Nom (A→Z)' },
  { valeur: 'creeLe:desc', libelle: 'Plus récent' },
];

describe('SelecteurTri', () => {
  it('est un bouton icône nommé par aria-label et infobulle, sans libellé visible', () => {
    render(
      <SelecteurTri
        options={OPTIONS}
        valeur="nom:asc"
        onChangeValeur={vi.fn()}
        label="Trier par"
      />,
    );
    const bouton = screen.getByRole('button', { name: 'Trier par' });
    expect(bouton).toHaveAttribute('title', 'Trier par');
    expect(screen.queryByText('Nom (A→Z)')).not.toBeInTheDocument();
  });

  it('émet la nouvelle valeur au format <champ>:<sens> à la sélection', async () => {
    const onChangeValeur = vi.fn();
    const utilisateur = userEvent.setup();
    render(
      <SelecteurTri
        options={OPTIONS}
        valeur="nom:asc"
        onChangeValeur={onChangeValeur}
        label="Trier par"
      />,
    );

    await utilisateur.click(screen.getByRole('button', { name: 'Trier par' }));
    await utilisateur.click(await screen.findByText('Plus récent'));
    expect(onChangeValeur).toHaveBeenCalledWith('creeLe:desc');
  });

  it('coche l’option active dans le menu', async () => {
    const utilisateur = userEvent.setup();
    render(
      <SelecteurTri
        options={OPTIONS}
        valeur="creeLe:desc"
        onChangeValeur={vi.fn()}
        label="Trier par"
      />,
    );
    await utilisateur.click(screen.getByRole('button', { name: 'Trier par' }));
    expect(await screen.findByRole('menuitemcheckbox', { name: 'Plus récent' })).toBeChecked();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Nom (A→Z)' })).not.toBeChecked();
  });
});
