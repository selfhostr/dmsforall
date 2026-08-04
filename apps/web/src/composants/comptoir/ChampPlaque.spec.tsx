import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ChampPlaque } from './ChampPlaque';

/** `ChampPlaque` est entièrement contrôlé (`valeur` vient du parent) : un test de frappe doit
 *  rejouer le cycle réel valeur -> onChangeValeur -> valeur, sinon chaque touche part d'une
 *  valeur figée et seul le dernier caractère est observé. */
function PlaqueControlee({ onChangeValeur }: { readonly onChangeValeur: (v: string) => void }) {
  const [valeur, setValeur] = useState('');
  return (
    <ChampPlaque
      valeur={valeur}
      onChangeValeur={(v) => {
        setValeur(v);
        onChangeValeur(v);
      }}
      label="Plaque"
    />
  );
}

describe('ChampPlaque', () => {
  it('normalise la saisie en majuscules sans espace ni tiret', async () => {
    const onChangeValeur = vi.fn();
    const utilisateur = userEvent.setup();
    render(<PlaqueControlee onChangeValeur={onChangeValeur} />);

    await utilisateur.type(screen.getByLabelText('Plaque'), 'vd 12-345');
    expect(onChangeValeur).toHaveBeenLastCalledWith('VD12345');
  });

  it('affiche une erreur associée au champ via aria-describedby', () => {
    render(
      <ChampPlaque valeur="VD1" onChangeValeur={vi.fn()} label="Plaque" erreur="Plaque invalide" />,
    );
    const champ = screen.getByLabelText('Plaque');
    expect(screen.getByText('Plaque invalide')).toBeInTheDocument();
    expect(champ).toHaveAttribute('aria-describedby', screen.getByText('Plaque invalide').id);
  });
});
