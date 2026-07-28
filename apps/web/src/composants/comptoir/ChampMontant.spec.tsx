import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ChampMontant } from './ChampMontant';

describe('ChampMontant', () => {
  it("n'émet qu'un entier de centimes pour une saisie décimale", async () => {
    const onChangeCentimes = vi.fn();
    const utilisateur = userEvent.setup();
    render(<ChampMontant valeurCentimes={null} onChangeCentimes={onChangeCentimes} label="Montant" />);

    await utilisateur.type(screen.getByLabelText('Montant'), '12.5');
    for (const appel of onChangeCentimes.mock.calls) {
      // null (saisie intermédiaire non interprétable, ex. "12.") est le seul cas où ce n'est
      // pas un entier — jamais un flottant, jamais NaN.
      expect(appel[0] === null || Number.isInteger(appel[0])).toBe(true);
    }
    expect(onChangeCentimes).toHaveBeenLastCalledWith(1250);
  });

  it('accepte la virgule comme séparateur décimal suisse', async () => {
    const onChangeCentimes = vi.fn();
    const utilisateur = userEvent.setup();
    render(<ChampMontant valeurCentimes={null} onChangeCentimes={onChangeCentimes} label="Montant" />);

    await utilisateur.type(screen.getByLabelText('Montant'), '9,90');
    expect(onChangeCentimes).toHaveBeenLastCalledWith(990);
  });

  it('émet null pour une saisie non interprétable, jamais une valeur devinée', async () => {
    const onChangeCentimes = vi.fn();
    const utilisateur = userEvent.setup();
    render(<ChampMontant valeurCentimes={100} onChangeCentimes={onChangeCentimes} label="Montant" />);

    await utilisateur.clear(screen.getByLabelText('Montant'));
    await utilisateur.type(screen.getByLabelText('Montant'), 'abc');
    expect(onChangeCentimes).toHaveBeenLastCalledWith(null);
  });

  it('affiche le montant formaté en aperçu suisse', () => {
    render(<ChampMontant valeurCentimes={123450} onChangeCentimes={vi.fn()} label="Montant" />);
    expect(screen.getByText("1'234.50")).toBeInTheDocument();
  });
});
