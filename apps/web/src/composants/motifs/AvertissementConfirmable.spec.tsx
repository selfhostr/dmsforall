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

  it("affiche `messageErreur` DANS la modale (issue #63 : jamais sous l'overlay), avec le rôle `alert`", () => {
    render(
      <AvertissementConfirmable
        ouvert
        onOuvertChange={() => {}}
        titre="Archiver ce véhicule ?"
        description="Il restera consultable en lecture seule."
        libelleConfirmation="Archiver"
        onConfirmer={() => {}}
        messageErreur="Impossible d'archiver : le véhicule a un ordre de réparation en cours."
      />,
    );

    const dialogue = screen.getByRole('dialog');
    const erreur = screen.getByRole('alert');
    expect(erreur).toHaveTextContent(
      "Impossible d'archiver : le véhicule a un ordre de réparation en cours.",
    );
    // Le nœud d'erreur est un DESCENDANT de la modale — pas un élément séparé ailleurs dans le
    // document (ce qui reproduirait le défaut : un bandeau vivant sous l'overlay de la modale).
    expect(dialogue.contains(erreur)).toBe(true);
  });

  it('sans `messageErreur`, ne rend aucun rôle `alert` (rétrocompatible avec les appelants existants)', () => {
    render(
      <AvertissementConfirmable
        ouvert
        onOuvertChange={() => {}}
        titre="Archiver ce véhicule ?"
        description="Il restera consultable en lecture seule."
        libelleConfirmation="Archiver"
        onConfirmer={() => {}}
      />,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it("reste ouverte tant que l'appelant ne referme pas — `messageErreur` seul ne ferme jamais la modale", async () => {
    const utilisateur = userEvent.setup();
    const onOuvertChange = vi.fn();
    render(
      <AvertissementConfirmable
        ouvert
        onOuvertChange={onOuvertChange}
        titre="Archiver ce véhicule ?"
        description="Il restera consultable en lecture seule."
        libelleConfirmation="Archiver"
        onConfirmer={() => {}}
        messageErreur="Échec de la tentative précédente."
      />,
    );

    await utilisateur.click(screen.getByRole('button', { name: 'Archiver' }));

    // `onConfirmer` ne pilote pas `ouvert` lui-même (composant contrôlé) : au bout d'un échec,
    // l'appelant est celui qui décide de ne PAS appeler `onOuvertChange(false)` — la modale, elle,
    // reste montée et son message d'erreur reste visible tant que rien ne la referme.
    expect(onOuvertChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
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
    expect(document.querySelector('.bg-statut-danger-fond')).not.toBeNull();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Aucune des deux couleurs n'apparaît sur l'autre composant : jamais indiscernables.
    const dialogPanel = screen.getByRole('dialog');
    expect(dialogPanel.querySelector('.bg-statut-danger-fond')).toBeNull();
    const encartRefus = screen.getByRole('alert');
    expect(encartRefus.querySelector('.text-statut-attention')).toBeNull();
  });
});
