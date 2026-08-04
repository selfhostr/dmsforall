import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { SelecteurTri } from './SelecteurTri';

// Radix Select (`@radix-ui/react-select`) appelle `hasPointerCapture`/`scrollIntoView`,
// absents de jsdom. Même stub que src/composants/recherche/PanneauResultatsRecherche.spec.tsx
// pour cmdk — local à ce fichier, seule suite du périmètre comptoir à ouvrir un `Select`.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const OPTIONS = [
  { valeur: 'nom:asc', libelle: 'Nom (A→Z)' },
  { valeur: 'creeLe:desc', libelle: 'Plus récent' },
];

describe('SelecteurTri', () => {
  it('affiche le libellé de la valeur sélectionnée', () => {
    render(
      <SelecteurTri
        options={OPTIONS}
        valeur="nom:asc"
        onChangeValeur={vi.fn()}
        label="Trier par"
      />,
    );
    expect(screen.getByText('Nom (A→Z)')).toBeInTheDocument();
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

    await utilisateur.click(screen.getByRole('combobox'));
    await utilisateur.click(await screen.findByText('Plus récent'));
    expect(onChangeValeur).toHaveBeenCalledWith('creeLe:desc');
  });
});
