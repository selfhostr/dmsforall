import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import '@/i18n';

import {
  ChampAutocompletionVehicule,
  type OptionAutocompletionVehicule,
} from './ChampAutocompletionVehicule';

const OPTIONS_MARQUES = [
  { valeur: 'Volkswagen', complement: '42 modèles' },
  { valeur: 'Volvo', complement: '18 modèles' },
];

/** Wrapper contrôlé minimal — le composant est un champ contrôlé (`valeur`/`onValeurChange`),
 *  jamais d'état interne caché pour la valeur elle-même. */
function ChampControle(props: {
  readonly valeurInitiale?: string;
  readonly options?: readonly OptionAutocompletionVehicule[];
  readonly enChargement?: boolean;
  readonly onSelectionOption?: (option: OptionAutocompletionVehicule) => void;
}) {
  const [valeur, setValeur] = useState(props.valeurInitiale ?? '');
  return (
    <ChampAutocompletionVehicule
      id="marque"
      libelle="Marque"
      valeur={valeur}
      onValeurChange={setValeur}
      options={props.options ?? OPTIONS_MARQUES}
      enChargement={props.enChargement ?? false}
      onSelectionOption={props.onSelectionOption}
    />
  );
}

describe('ChampAutocompletionVehicule', () => {
  it('la saisie libre met à jour la valeur sans jamais forcer une sélection', async () => {
    const utilisateur = userEvent.setup();
    render(<ChampControle />);

    const champ = screen.getByRole('combobox', { name: 'Marque' });
    await utilisateur.type(champ, 'Une marque totalement inconnue');

    expect(champ).toHaveValue('Une marque totalement inconnue');
  });

  it('affiche les suggestions et permet de choisir au clic — remplit le champ avec le nom choisi', async () => {
    const utilisateur = userEvent.setup();
    const onSelectionOption = vi.fn();
    render(<ChampControle onSelectionOption={onSelectionOption} />);

    const champ = screen.getByRole('combobox', { name: 'Marque' });
    await utilisateur.click(champ);

    const option = await screen.findByRole('option', { name: /Volkswagen/ });
    await utilisateur.click(option);

    expect(champ).toHaveValue('Volkswagen');
    expect(onSelectionOption).toHaveBeenCalledWith(OPTIONS_MARQUES[0]);
  });

  it('navigation clavier complète : Flèche bas puis Entrée sélectionne la suggestion active', async () => {
    const utilisateur = userEvent.setup();
    render(<ChampControle />);

    const champ = screen.getByRole('combobox', { name: 'Marque' });
    await utilisateur.click(champ);
    await screen.findByRole('option', { name: /Volkswagen/ });

    await utilisateur.keyboard('{ArrowDown}');
    await utilisateur.keyboard('{Enter}');

    expect(champ).toHaveValue('Volkswagen');
  });

  it('Échap ferme la liste sans effacer la saisie en cours', async () => {
    const utilisateur = userEvent.setup();
    render(<ChampControle />);

    const champ = screen.getByRole('combobox', { name: 'Marque' });
    await utilisateur.type(champ, 'Volksw');
    await screen.findByRole('option', { name: /Volkswagen/ });

    await utilisateur.keyboard('{Escape}');

    expect(champ).toHaveValue('Volksw');
    expect(champ).toHaveAttribute('aria-expanded', 'false');
  });

  it('signale une valeur hors référentiel une fois la saisie terminée (perte de focus) — jamais pendant la frappe', async () => {
    const utilisateur = userEvent.setup();
    render(<ChampControle />);

    const champ = screen.getByRole('combobox', { name: 'Marque' });
    await utilisateur.type(champ, 'Une marque totalement inconnue');
    expect(screen.queryByText(/Absent de la liste/)).not.toBeInTheDocument();

    await utilisateur.tab();

    expect(await screen.findByText(/Absent de la liste/)).toBeInTheDocument();
  });

  it('n\'affiche jamais le repli "hors référentiel" pour une valeur vide', async () => {
    const utilisateur = userEvent.setup();
    render(<ChampControle />);

    const champ = screen.getByRole('combobox', { name: 'Marque' });
    await utilisateur.click(champ);
    await utilisateur.tab();

    expect(screen.queryByText(/Absent de la liste/)).not.toBeInTheDocument();
  });

  it('ne signale pas "hors référentiel" pour une valeur reconnue (tolérante à la casse et aux accents)', async () => {
    const utilisateur = userEvent.setup();
    render(<ChampControle />);

    const champ = screen.getByRole('combobox', { name: 'Marque' });
    await utilisateur.type(champ, 'volkswagen');
    await utilisateur.tab();

    expect(screen.queryByText(/Absent de la liste/)).not.toBeInTheDocument();
  });

  it('annonce le chargement puis le nombre de résultats pour les lecteurs d’écran', async () => {
    const utilisateur = userEvent.setup();
    const { rerender } = render(<ChampControle enChargement />);

    const champ = screen.getByRole('combobox', { name: 'Marque' });
    await utilisateur.click(champ);

    expect(screen.getByRole('status')).toHaveTextContent('Recherche en cours');

    rerender(<ChampControle enChargement={false} />);
    expect(await screen.findByRole('status')).toHaveTextContent('2 résultats');
  });

  it('annonce "aucun résultat" sans jamais rejeter la saisie comme une erreur', async () => {
    const utilisateur = userEvent.setup();
    render(<ChampControle options={[]} />);

    const champ = screen.getByRole('combobox', { name: 'Marque' });
    await utilisateur.click(champ);

    expect(
      (
        await screen.findAllByText(
          'Aucune correspondance dans le référentiel — vous pouvez saisir librement.',
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(champ).not.toHaveAttribute('aria-invalid');
  });

  it('une panne de la recherche de suggestions reste visible SANS jamais bloquer la saisie libre ni l’étiqueter "hors référentiel"', async () => {
    const utilisateur = userEvent.setup();
    render(
      <ChampAutocompletionVehicule
        id="marque"
        libelle="Marque"
        valeur="Une marque tapée à la main"
        onValeurChange={vi.fn()}
        options={[]}
        enChargement={false}
        erreur="Impossible de charger les suggestions."
      />,
    );

    const champ = screen.getByRole('combobox', { name: 'Marque' });
    await utilisateur.click(champ);

    expect(
      (await screen.findAllByText('Impossible de charger les suggestions.')).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/Absent de la liste/)).not.toBeInTheDocument();
    expect(champ).toHaveValue('Une marque tapée à la main');
    expect(champ).not.toBeDisabled();
  });
});
