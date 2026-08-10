import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { BarreFiltres } from './BarreFiltres';

describe('BarreFiltres', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('appelle onChangeQ à la saisie dans le champ de recherche', async () => {
    const onChangeQ = vi.fn();
    const utilisateur = userEvent.setup();
    render(
      <BarreFiltres q="" onChangeQ={onChangeQ} filtresActifs={false} onEffacerFiltres={vi.fn()} />,
    );

    await utilisateur.type(screen.getByRole('searchbox'), 'a');
    expect(onChangeQ).toHaveBeenCalledWith('a');
  });

  it('désactive « Effacer les filtres » tant qu’aucun filtre n’est actif', () => {
    render(
      <BarreFiltres q="" onChangeQ={vi.fn()} filtresActifs={false} onEffacerFiltres={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /Effacer les filtres/ })).toBeDisabled();
  });

  it('appelle onEffacerFiltres au clic quand des filtres sont actifs', async () => {
    const onEffacerFiltres = vi.fn();
    const utilisateur = userEvent.setup();
    render(
      <BarreFiltres q="a" onChangeQ={vi.fn()} filtresActifs onEffacerFiltres={onEffacerFiltres} />,
    );

    await utilisateur.click(screen.getByRole('button', { name: /Effacer les filtres/ }));
    expect(onEffacerFiltres).toHaveBeenCalled();
  });

  it('traduit le bouton « Effacer les filtres » en allemand', async () => {
    await i18n.changeLanguage('de');
    render(
      <BarreFiltres q="" onChangeQ={vi.fn()} filtresActifs={false} onEffacerFiltres={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: /Filter löschen/ })).toBeInTheDocument();
  });

  it('aligne la rangée sur le bas de ses enfants (items-end), pas leur centre', () => {
    // Régression pixel (mesuré Playwright) : un filtre étiqueté (`<Label>` + `<Select>`, ~70px)
    // à côté d'un contrôle nu de 44px (recherche, bouton) ne tombe au même `top` que ses voisins
    // qu'aligné sur le bas de la rangée. `items-center` centre chaque enfant sur SA PROPRE hauteur
    // et désaligne dès qu'un enfant porte une étiquette — JSDOM ne calcule pas de vraie mise en
    // page (`getBoundingClientRect` y reste à zéro), donc ce test verrouille la classe plutôt que
    // le pixel ; la preuve au pixel est la mesure Playwright, pas ce test.
    const { container } = render(
      <BarreFiltres q="" onChangeQ={vi.fn()} filtresActifs={false} onEffacerFiltres={vi.fn()} />,
    );
    const rangee = container.firstElementChild;
    expect(rangee).not.toBeNull();
    expect(rangee?.className).toContain('items-end');
    expect(rangee?.className).not.toContain('items-center');
  });
});
