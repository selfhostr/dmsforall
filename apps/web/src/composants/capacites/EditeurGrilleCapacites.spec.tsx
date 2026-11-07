import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import type { IdPrereglage } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { EditeurGrilleCapacites } from './EditeurGrilleCapacites';
import { modeleCapacitesDeTest } from './modele-test';
import { useGrilleEditable } from './useGrilleEditable';

const modele = modeleCapacitesDeTest();

function Harnais({
  prereglage = 'technicien',
  erreursChamp,
}: {
  readonly prereglage?: IdPrereglage;
  readonly erreursChamp?: Record<string, string>;
}) {
  const etat = useGrilleEditable({ modele, prereglageInitial: prereglage });
  return <EditeurGrilleCapacites modele={modele} etat={etat} erreursChamp={erreursChamp} />;
}

const t = (cle: string, o?: Record<string, unknown>) => i18n.t(cle, o);

function groupe(domaine: string) {
  return screen.getByRole('radiogroup', {
    name: t('capacites:editeur.domaineAria', {
      domaine: t(`capacites:domaines.${domaine}.libelle`),
    }),
  });
}

describe('EditeurGrilleCapacites', () => {
  it('affiche la grille du préréglage, description et exemples compris', () => {
    render(<Harnais prereglage="technicien" />);
    expect(within(groupe('atelier')).getByRole('radio', { name: 'Faire' })).toBeChecked();
    expect(within(groupe('finances')).getByRole('radio', { name: 'Rien' })).toBeChecked();
    expect(screen.getByText(t('capacites:domaines.pieces.description'))).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(t('capacites:domaines.pieces.exemples.1'))),
    ).toBeInTheDocument();
    expect(screen.queryByText(t('capacites:editeur.personnalise'))).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Encadre l'équipe/ })).not.toBeChecked();
  });

  it('affiche « Personnalisé » dès que la grille s’écarte, et revient au préréglage', async () => {
    const utilisateur = userEvent.setup();
    render(<Harnais prereglage="technicien" />);

    await utilisateur.click(within(groupe('pieces')).getByRole('radio', { name: 'Faire' }));
    expect(screen.getByText(t('capacites:editeur.personnalise'))).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: t('capacites:editeur.revenir') }));
    expect(screen.queryByText(t('capacites:editeur.personnalise'))).not.toBeInTheDocument();
    expect(within(groupe('pieces')).getByRole('radio', { name: 'Voir' })).toBeChecked();
  });

  it('signale avant envoi une incohérence : Finances sans « Voit les montants »', async () => {
    const utilisateur = userEvent.setup();
    render(<Harnais prereglage="technicien" />);

    await utilisateur.click(within(groupe('finances')).getByRole('radio', { name: 'Voir' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      t('capacites:editeur.incoherence.finances'),
    );

    await utilisateur.click(screen.getByRole('checkbox', { name: /Voit les montants/ }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('affiche une erreur du serveur sur le champ nommé', () => {
    render(<Harnais erreursChamp={{ 'niveaux.ventes': 'Dépassement signalé par le serveur' }} />);
    const alerte = screen.getByRole('alert');
    expect(alerte).toHaveTextContent('Dépassement signalé par le serveur');
    expect(groupe('ventes')).toHaveAccessibleDescription('Dépassement signalé par le serveur');
  });
});
