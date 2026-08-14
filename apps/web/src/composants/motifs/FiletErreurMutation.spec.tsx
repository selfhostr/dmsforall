import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { FiletErreurMutation } from './FiletErreurMutation';
import {
  afficherToastFiletErreurMutation,
  reinitialiserFiletErreurMutation,
} from './filet-erreur-mutation';

async function attendreI18nPret() {
  if (!i18n.isInitialized) {
    await new Promise<void>((resoudre) => i18n.on('initialized', () => resoudre()));
  }
}

describe('FiletErreurMutation', () => {
  afterEach(() => {
    reinitialiserFiletErreurMutation();
  });

  it('ne rend rien tant qu’aucun toast n’est affiché', async () => {
    await attendreI18nPret();
    const { container } = render(<FiletErreurMutation />);
    expect(container).toBeEmptyDOMElement();
  });

  it('affiche le titre et le message dès qu’un toast est poussé dans le magasin, avec role="alert"', async () => {
    await attendreI18nPret();
    render(<FiletErreurMutation />);

    act(() => {
      afficherToastFiletErreurMutation(new Error('échec quelconque'), i18n.t);
    });

    const toast = await screen.findByRole('alert');
    expect(toast).toHaveTextContent("Une erreur s'est produite");
  });

  it('le bouton fermer retire le toast', async () => {
    await attendreI18nPret();
    const utilisateur = userEvent.setup();
    render(<FiletErreurMutation />);

    act(() => {
      afficherToastFiletErreurMutation(new Error('échec quelconque'), i18n.t);
    });
    await screen.findByRole('alert');

    await utilisateur.click(screen.getByRole('button', { name: 'Fermer' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('empile plusieurs toasts indépendamment (un échec supplémentaire ne remplace pas le précédent)', async () => {
    await attendreI18nPret();
    render(<FiletErreurMutation />);

    act(() => {
      afficherToastFiletErreurMutation(new Error('premier échec'), i18n.t);
      afficherToastFiletErreurMutation(new Error('second échec'), i18n.t);
    });

    expect(await screen.findAllByRole('alert')).toHaveLength(2);
  });
});
