import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { BarreFiltres } from './BarreFiltres';

describe('BarreFiltres', () => {
  it('appelle onChangeQ à la saisie dans le champ de recherche', async () => {
    const onChangeQ = vi.fn();
    const utilisateur = userEvent.setup();
    render(<BarreFiltres q="" onChangeQ={onChangeQ} />);

    await utilisateur.type(screen.getByRole('searchbox'), 'a');
    expect(onChangeQ).toHaveBeenCalledWith('a');
  });

  it('n’affiche plus de bouton « Effacer les filtres »', () => {
    render(<BarreFiltres q="a" onChangeQ={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Effacer les filtres/ })).not.toBeInTheDocument();
  });

  it('range recherche, filtres et tri sur une ligne qui passe à la ligne sans chevaucher', () => {
    // JSDOM ne calcule pas de mise en page : on verrouille les classes (la preuve au pixel est la
    // mesure navigateur).
    const { container } = render(
      <BarreFiltres q="" onChangeQ={vi.fn()} tri={<button type="button">Tri</button>}>
        <button type="button">Filtre</button>
      </BarreFiltres>,
    );
    const rangee = container.firstElementChild;
    expect(rangee?.className).toContain('flex-wrap');
    expect(rangee?.className).not.toContain('flex-nowrap');
    expect(rangee?.className).toContain('items-center');
    expect(screen.getByRole('button', { name: 'Filtre' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tri' })).toBeInTheDocument();
  });

  it('laisse la recherche rétrécir quand la place manque', () => {
    render(<BarreFiltres q="" onChangeQ={vi.fn()} />);
    const zone = screen.getByRole('searchbox').parentElement;
    expect(zone?.className).toContain('flex-1');
  });

  describe('action de création', () => {
    it('bouton carré « + » sans texte : nom accessible et infobulle identiques, 44 px', async () => {
      const onClick = vi.fn();
      const utilisateur = userEvent.setup();
      render(
        <BarreFiltres
          q=""
          onChangeQ={vi.fn()}
          actionCreer={{ libelle: 'Créer un ordre de réparation', onClick }}
        />,
      );
      const bouton = screen.getByRole('button', { name: 'Créer un ordre de réparation' });
      expect(bouton).toHaveAttribute('aria-label', 'Créer un ordre de réparation');
      expect(bouton).toHaveTextContent('');
      expect(bouton.className).toContain('h-11');
      expect(bouton.className).toContain('w-11');

      await utilisateur.hover(bouton);
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Créer un ordre de réparation');

      await utilisateur.click(bouton);
      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('l’infobulle apparaît aussi au focus clavier', async () => {
      const utilisateur = userEvent.setup();
      render(
        <BarreFiltres
          q=""
          onChangeQ={vi.fn()}
          actionCreer={{ libelle: 'Nouveau rendez-vous', onClick: vi.fn() }}
        />,
      );
      await utilisateur.tab();
      await utilisateur.tab();
      expect(screen.getByRole('button', { name: 'Nouveau rendez-vous' })).toHaveFocus();
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Nouveau rendez-vous');
    });

    it('se range tout au bout de la barre, après la recherche, les filtres et le tri', () => {
      render(
        <BarreFiltres
          q=""
          onChangeQ={vi.fn()}
          tri={<button type="button">Tri</button>}
          actionCreer={{ libelle: 'Créer un client', onClick: vi.fn() }}
        >
          <button type="button">Filtre</button>
        </BarreFiltres>,
      );
      const noms = screen.getAllByRole('button').map((b) => b.textContent || b.ariaLabel);
      expect(noms).toEqual(['Filtre', 'Tri', 'Créer un client']);
      expect(screen.getByTestId('action-creer-barre').parentElement).toBe(
        screen.getByRole('searchbox').closest('div')?.parentElement,
      );
      expect(screen.getByTestId('action-creer-barre').nextElementSibling).toBeNull();
    });

    it('navigue par un lien quand `to` est fourni', () => {
      render(
        <MemoryRouter>
          <BarreFiltres
            q=""
            onChangeQ={vi.fn()}
            actionCreer={{ libelle: 'Créer un véhicule', to: '/vehicules/nouveau' }}
          />
        </MemoryRouter>,
      );
      expect(screen.getByRole('link', { name: 'Créer un véhicule' })).toHaveAttribute(
        'href',
        '/vehicules/nouveau',
      );
    });

    it('rien n’est rendu sans `actionCreer` (droit absent)', () => {
      render(<BarreFiltres q="" onChangeQ={vi.fn()} />);
      expect(screen.queryByTestId('action-creer-barre')).not.toBeInTheDocument();
    });
  });
});
