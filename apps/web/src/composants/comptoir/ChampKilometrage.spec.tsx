import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChampKilometrage } from './ChampKilometrage';

describe('ChampKilometrage', () => {
  it("n'émet qu'un entier, jamais de décimale", async () => {
    const onChangeValeur = vi.fn();
    const utilisateur = userEvent.setup();
    render(
      <ChampKilometrage
        valeur={null}
        onChangeValeur={onChangeValeur}
        unite="km"
        label="Kilométrage"
      />,
    );

    await utilisateur.type(screen.getByLabelText('Kilométrage'), '125340');
    expect(onChangeValeur).toHaveBeenLastCalledWith(125340);
    for (const appel of onChangeValeur.mock.calls) {
      if (appel[0] !== null) expect(Number.isInteger(appel[0])).toBe(true);
    }
  });

  it("affiche l'unité fournie en suffixe, sans conversion", () => {
    render(
      <ChampKilometrage valeur={55000} onChangeValeur={vi.fn()} unite="mi" label="Kilométrage" />,
    );
    expect(screen.getByText('mi')).toBeInTheDocument();
    expect(screen.getByDisplayValue('55000')).toBeInTheDocument();
  });

  it('émet null quand le champ est vidé', async () => {
    const onChangeValeur = vi.fn();
    const utilisateur = userEvent.setup();
    render(
      <ChampKilometrage
        valeur={100}
        onChangeValeur={onChangeValeur}
        unite="km"
        label="Kilométrage"
      />,
    );

    await utilisateur.clear(screen.getByLabelText('Kilométrage'));
    expect(onChangeValeur).toHaveBeenLastCalledWith(null);
  });
});
