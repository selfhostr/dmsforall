import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TableComptoir, type ColonneComptoir } from './TableComptoir';

interface LigneTest {
  readonly id: string;
  readonly nom: string;
}

const LIGNES: LigneTest[] = [
  { id: '1', nom: 'Alice' },
  { id: '2', nom: 'Bob' },
];

const COLONNES: ColonneComptoir<LigneTest>[] = [
  { id: 'nom', libelle: 'Nom', triable: true, rendu: (ligne) => ligne.nom },
];

describe('TableComptoir', () => {
  it('rend une ligne par élément et déclenche la navigation au clic', async () => {
    const onOuvrirLigne = vi.fn();
    const utilisateur = userEvent.setup();
    render(
      <TableComptoir
        colonnes={COLONNES}
        lignes={LIGNES}
        cleLigne={(l) => l.id}
        onOuvrirLigne={onOuvrirLigne}
      />,
    );

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();

    await utilisateur.click(screen.getByText('Alice'));
    expect(onOuvrirLigne).toHaveBeenCalledWith(LIGNES[0]);
  });

  it('navigue au clavier avec Entrée sur une ligne focalisée', async () => {
    const onOuvrirLigne = vi.fn();
    const utilisateur = userEvent.setup();
    render(
      <TableComptoir
        colonnes={COLONNES}
        lignes={LIGNES}
        cleLigne={(l) => l.id}
        onOuvrirLigne={onOuvrirLigne}
      />,
    );

    const lignes = screen.getAllByRole('link');
    lignes[1]?.focus();
    await utilisateur.keyboard('{Enter}');
    expect(onOuvrirLigne).toHaveBeenCalledWith(LIGNES[1]);
  });

  it('pose aria-sort sur la colonne triée et appelle onTrier au clic sur l’en-tête', async () => {
    const onTrier = vi.fn();
    const utilisateur = userEvent.setup();
    render(
      <TableComptoir
        colonnes={COLONNES}
        lignes={LIGNES}
        cleLigne={(l) => l.id}
        tri={{ colonneId: 'nom', sens: 'asc' }}
        onTrier={onTrier}
      />,
    );

    const enTete = screen.getByRole('columnheader', { name: /Nom/ });
    expect(enTete).toHaveAttribute('aria-sort', 'ascending');

    await utilisateur.click(screen.getByRole('button', { name: /Nom/ }));
    expect(onTrier).toHaveBeenCalledWith('nom');
  });

  it('rend le contenu vide fourni sans ligne quand la liste est vide', () => {
    render(
      <TableComptoir
        colonnes={COLONNES}
        lignes={[]}
        cleLigne={(l) => l.id}
        contenuVide={<p>Aucun résultat</p>}
      />,
    );
    expect(screen.getByText('Aucun résultat')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('rend des lignes squelette pendant le chargement, pas de contenu vide', () => {
    const { container } = render(
      <TableComptoir
        colonnes={COLONNES}
        lignes={[]}
        cleLigne={(l) => l.id}
        enChargement
        lignesSquelette={3}
        contenuVide={<p>Aucun résultat</p>}
      />,
    );
    expect(screen.queryByText('Aucun résultat')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3);
  });
});
