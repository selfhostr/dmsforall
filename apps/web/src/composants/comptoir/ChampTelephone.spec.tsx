import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ChampTelephone } from './ChampTelephone';

/** Champ entièrement contrôlé : voir le même commentaire dans ChampPlaque.spec.tsx — il faut
 *  rejouer le cycle valeur -> onChangeValeur -> valeur pour observer une frappe accumulée. */
function TelephoneControle({ onChangeValeur }: { readonly onChangeValeur: (v: string) => void }) {
  const [valeur, setValeur] = useState('');
  return (
    <ChampTelephone
      valeur={valeur}
      onChangeValeur={(v) => {
        setValeur(v);
        onChangeValeur(v);
      }}
      label="Téléphone"
    />
  );
}

describe('ChampTelephone', () => {
  it('transmet la saisie brute sans la normaliser', async () => {
    const onChangeValeur = vi.fn();
    const utilisateur = userEvent.setup();
    render(<TelephoneControle onChangeValeur={onChangeValeur} />);

    await utilisateur.type(screen.getByLabelText('Téléphone'), '079');
    expect(onChangeValeur).toHaveBeenLastCalledWith('079');
  });

  it('pose type=tel pour le clavier numérique mobile', () => {
    render(<ChampTelephone valeur="" onChangeValeur={vi.fn()} label="Téléphone" />);
    expect(screen.getByLabelText('Téléphone')).toHaveAttribute('type', 'tel');
  });
});
