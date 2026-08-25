import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { ZoneDepotFichier } from './ZoneDepotFichier';

describe('ZoneDepotFichier', () => {
  it('utilisable au clavier seul : Tab l’atteint, Entrée ouvre le sélecteur natif', async () => {
    const onFichierChoisi = vi.fn();
    render(<ZoneDepotFichier onFichierChoisi={onFichierChoisi} />);

    const utilisateur = userEvent.setup();
    const zone = screen.getByRole('button');
    expect(zone).toHaveAttribute('tabIndex', '0');

    await utilisateur.tab();
    expect(zone).toHaveFocus();

    const entree = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clic = vi.spyOn(entree, 'click');
    await utilisateur.keyboard('{Enter}');
    expect(clic).toHaveBeenCalled();
  });

  it('désactivée : hors du parcours de tabulation, aucun clic ne déclenche le sélecteur', async () => {
    const onFichierChoisi = vi.fn();
    render(<ZoneDepotFichier onFichierChoisi={onFichierChoisi} desactive />);

    const zone = screen.getByRole('button');
    expect(zone).toHaveAttribute('aria-disabled', 'true');
    expect(zone).toHaveAttribute('tabIndex', '-1');
  });

  it('sélection d’un fichier via l’input déclenche onFichierChoisi', async () => {
    const onFichierChoisi = vi.fn();
    render(<ZoneDepotFichier onFichierChoisi={onFichierChoisi} />);

    const entree = document.querySelector('input[type="file"]') as HTMLInputElement;
    const fichier = new File(['contenu'], 'archive.zip', { type: 'application/zip' });
    const utilisateur = userEvent.setup();
    await utilisateur.upload(entree, fichier);

    expect(onFichierChoisi).toHaveBeenCalledWith(fichier);
  });
});
