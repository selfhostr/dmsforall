import { render, screen } from '@testing-library/react';
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

  it('range recherche, filtres et tri sur une seule ligne, sans retour à la ligne', () => {
    // JSDOM ne calcule pas de mise en page : on verrouille les classes (la preuve au pixel est la
    // mesure navigateur).
    const { container } = render(
      <BarreFiltres q="" onChangeQ={vi.fn()} tri={<button type="button">Tri</button>}>
        <button type="button">Filtre</button>
      </BarreFiltres>,
    );
    const rangee = container.firstElementChild;
    expect(rangee?.className).toContain('flex-nowrap');
    expect(rangee?.className).not.toContain('flex-wrap ');
    expect(rangee?.className).toContain('items-center');
    expect(screen.getByRole('button', { name: 'Filtre' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tri' })).toBeInTheDocument();
  });

  it('laisse la recherche rétrécir quand la place manque', () => {
    render(<BarreFiltres q="" onChangeQ={vi.fn()} />);
    const zone = screen.getByRole('searchbox').parentElement;
    expect(zone?.className).toContain('flex-1');
  });
});
