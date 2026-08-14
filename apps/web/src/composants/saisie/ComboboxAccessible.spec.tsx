import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Popover } from '@/components/ui/popover';

import {
  AnnonceLiveCombobox,
  ChampCombobox,
  ListeOptionsCombobox,
  OptionCombobox,
  PopoverContenuCombobox,
  useComboboxAccessible,
} from './ComboboxAccessible';

interface Fruit {
  readonly id: string;
  readonly nom: string;
}

const FRUITS: readonly Fruit[] = [
  { id: 'pomme', nom: 'Pomme' },
  { id: 'poire', nom: 'Poire' },
];

/** Harnais minimal — exerce le primitif tel qu'un appelant réel l'assemble (voir
 *  `ChampAutocompletionVehicule` et `SelecteurArticlePiece`), sans aucune politique métier :
 *  juste la mécanique commune (champ + popover, clavier, ARIA, sélection explicite). */
function Harnais(props: {
  readonly options?: readonly Fruit[];
  readonly onChoisir?: (fruit: Fruit) => void;
}) {
  const options = props.options ?? FRUITS;
  const [valeur, setValeur] = useState('');
  const combobox = useComboboxAccessible<Fruit>({
    options,
    onChoisir: (fruit) => {
      setValeur(fruit.nom);
      props.onChoisir?.(fruit);
    },
  });

  return (
    <div>
      <Popover open={combobox.ouvert} onOpenChange={combobox.setOuvert}>
        <ChampCombobox
          ref={combobox.inputRef}
          id="fruit"
          ariaLabel="Fruit"
          ouvert={combobox.ouvert}
          idListe={combobox.idListe}
          idActif={combobox.idActif}
          value={valeur}
          onChange={(evenement) => {
            setValeur(evenement.target.value);
            combobox.gererSaisie();
          }}
          onFocus={combobox.gererFocus}
          onBlur={combobox.gererPerteFocus}
          onKeyDown={combobox.gererClavier}
        />
        <PopoverContenuCombobox>
          {options.length === 0 ? (
            <p>Aucun résultat</p>
          ) : (
            <ListeOptionsCombobox id={combobox.idListe} ariaLabel="Fruit">
              {options.map((fruit, index) => (
                <OptionCombobox
                  key={fruit.id}
                  id={combobox.idOption(index)}
                  actif={index === combobox.indexActif}
                  onClick={() => combobox.choisir(fruit)}
                >
                  {fruit.nom}
                </OptionCombobox>
              ))}
            </ListeOptionsCombobox>
          )}
        </PopoverContenuCombobox>
      </Popover>
      <AnnonceLiveCombobox>
        {combobox.ouvert ? `${String(options.length)} résultats` : ''}
      </AnnonceLiveCombobox>
    </div>
  );
}

describe('ComboboxAccessible (primitif)', () => {
  it('porte les attributs ARIA combobox/listbox/option attendus', async () => {
    const utilisateur = userEvent.setup();
    render(<Harnais />);

    const champ = screen.getByRole('combobox', { name: 'Fruit' });
    expect(champ).toHaveAttribute('aria-expanded', 'false');
    expect(champ).toHaveAttribute('aria-autocomplete', 'list');
    expect(champ).not.toHaveAttribute('aria-activedescendant');

    await utilisateur.click(champ);
    expect(champ).toHaveAttribute('aria-expanded', 'true');

    const listbox = await screen.findByRole('listbox', { name: 'Fruit' });
    expect(champ).toHaveAttribute('aria-controls', listbox.id);

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
  });

  it('navigation clavier : ArrowDown déplace aria-activedescendant sur chaque option successivement', async () => {
    const utilisateur = userEvent.setup();
    render(<Harnais />);

    const champ = screen.getByRole('combobox', { name: 'Fruit' });
    await utilisateur.click(champ);
    const [premiereOption, deuxiemeOption] = screen.getAllByRole('option');

    await utilisateur.keyboard('{ArrowDown}');
    expect(champ).toHaveAttribute('aria-activedescendant', premiereOption?.id);

    await utilisateur.keyboard('{ArrowDown}');
    expect(champ).toHaveAttribute('aria-activedescendant', deuxiemeOption?.id);

    // Borne haute : une flèche bas supplémentaire ne dépasse pas la dernière option.
    await utilisateur.keyboard('{ArrowDown}');
    expect(champ).toHaveAttribute('aria-activedescendant', deuxiemeOption?.id);

    await utilisateur.keyboard('{ArrowUp}');
    expect(champ).toHaveAttribute('aria-activedescendant', premiereOption?.id);
  });

  it("Entrée sélectionne uniquement l'option active — jamais sur une simple frappe", async () => {
    const utilisateur = userEvent.setup();
    const onChoisir = vi.fn();
    render(<Harnais onChoisir={onChoisir} />);

    const champ = screen.getByRole('combobox', { name: 'Fruit' });
    await utilisateur.type(champ, 'Poi');
    expect(onChoisir).not.toHaveBeenCalled();

    await utilisateur.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(onChoisir).toHaveBeenCalledWith(FRUITS[1]);
    expect(champ).toHaveValue('Poire');
    expect(champ).toHaveAttribute('aria-expanded', 'false');
  });

  it('le clic sur une option la choisit et referme la liste en rendant le focus au champ', async () => {
    const utilisateur = userEvent.setup();
    const onChoisir = vi.fn();
    render(<Harnais onChoisir={onChoisir} />);

    const champ = screen.getByRole('combobox', { name: 'Fruit' });
    await utilisateur.click(champ);
    await utilisateur.click(screen.getByRole('option', { name: 'Pomme' }));

    expect(onChoisir).toHaveBeenCalledWith(FRUITS[0]);
    expect(champ).toHaveValue('Pomme');
    expect(champ).toHaveAttribute('aria-expanded', 'false');
    expect(champ).toHaveFocus();
  });

  it('Échap ferme la liste sans rien sélectionner', async () => {
    const utilisateur = userEvent.setup();
    const onChoisir = vi.fn();
    render(<Harnais onChoisir={onChoisir} />);

    const champ = screen.getByRole('combobox', { name: 'Fruit' });
    await utilisateur.click(champ);
    await utilisateur.keyboard('{ArrowDown}{Escape}');

    expect(champ).toHaveAttribute('aria-expanded', 'false');
    expect(onChoisir).not.toHaveBeenCalled();
  });

  it('annonce le nombre de résultats pour les lecteurs d’écran à l’ouverture', async () => {
    const utilisateur = userEvent.setup();
    render(<Harnais />);

    await utilisateur.click(screen.getByRole('combobox', { name: 'Fruit' }));

    expect(screen.getByRole('status')).toHaveTextContent('2 résultats');
  });
});
