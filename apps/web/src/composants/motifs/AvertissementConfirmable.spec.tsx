import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import '@/i18n';

import { AvertissementConfirmable } from './AvertissementConfirmable';
import { RefusBloquant } from './RefusBloquant';

vi.mock('@/observabilite/sentry', () => ({
  signalerErreur: vi.fn().mockResolvedValue(undefined),
}));

describe('AvertissementConfirmable', () => {
  it('rend la question, la conséquence, et nomme le bouton par le verbe exact (jamais « OK »/« Confirmer »)', () => {
    render(
      <AvertissementConfirmable
        ouvert
        onOuvertChange={() => {}}
        titre="Fusionner ces deux fiches client ?"
        description="Les véhicules et OR de Jean Dupont seront rattachés à Jean-Pierre Dupont."
        libelleConfirmation="Fusionner"
        onConfirmer={() => {}}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Fusionner ces deux fiches client ?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Les véhicules et OR de Jean Dupont seront rattachés à Jean-Pierre Dupont.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fusionner' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirmer' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
  });

  it('appelle `onConfirmer` au clic sur le bouton de confirmation', async () => {
    const utilisateur = userEvent.setup();
    const onConfirmer = vi.fn();
    render(
      <AvertissementConfirmable
        ouvert
        onOuvertChange={() => {}}
        titre="Archiver ce véhicule ?"
        description="Il restera consultable en lecture seule."
        libelleConfirmation="Archiver"
        onConfirmer={onConfirmer}
      />,
    );

    await utilisateur.click(screen.getByRole('button', { name: 'Archiver' }));
    expect(onConfirmer).toHaveBeenCalledTimes(1);
  });

  it('ne rend rien quand `ouvert` est faux', () => {
    render(
      <AvertissementConfirmable
        ouvert={false}
        onOuvertChange={() => {}}
        titre="Fusionner ces deux fiches client ?"
        description="Conséquence."
        libelleConfirmation="Fusionner"
        onConfirmer={() => {}}
      />,
    );
    expect(screen.queryByText('Fusionner ces deux fiches client ?')).not.toBeInTheDocument();
  });

  it('reste visuellement distinct de `RefusBloquant` à 100 % (ambre modal vs rouge encart inline, §9.5)', () => {
    render(
      <AvertissementConfirmable
        ouvert
        onOuvertChange={() => {}}
        titre="Fusionner ces deux fiches client ?"
        description="Conséquence."
        libelleConfirmation="Fusionner"
        onConfirmer={() => {}}
      />,
    );
    render(
      <RefusBloquant
        code="OR_ANNULATION_IMPOSSIBLE"
        blocages={[]}
        actionsProposees={[]}
        estTerminal
      />,
    );

    // AvertissementConfirmable : accent ambre (--statut-attention), modal (role="dialog").
    expect(document.querySelector('.text-statut-attention')).not.toBeNull();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // RefusBloquant : encart rouge inline (--statut-danger), jamais un dialog modal.
    expect(document.querySelector('.text-statut-danger')).not.toBeNull();
    expect(document.querySelector('.bg-statut-danger\\/12')).not.toBeNull();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Aucune des deux couleurs n'apparaît sur l'autre composant : jamais indiscernables.
    const dialogPanel = screen.getByRole('dialog');
    expect(dialogPanel.querySelector('.bg-statut-danger\\/12')).toBeNull();
    const encartRefus = screen.getByRole('alert');
    expect(encartRefus.querySelector('.text-statut-attention')).toBeNull();
  });
});
