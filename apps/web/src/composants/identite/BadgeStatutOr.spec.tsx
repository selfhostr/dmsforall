import { ETATS_AFFICHES_ORDRE_REPARATION, type EtatAfficheOrdreReparation } from '@dfa/shared';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { BadgeStatutOr } from './BadgeStatutOr';

const MOTS_FR: Readonly<Record<EtatAfficheOrdreReparation, string>> = {
  planifie: 'Planifié',
  ouvert: 'Ouvert',
  en_cours: 'En cours',
  attente_accord: 'Attente accord',
  attente_pieces: 'Attente pièces',
  attente_externe: 'Attente externe',
  controle: 'Contrôle',
  termine: 'Travaux terminés',
  facture: 'Facturé',
  restitue: 'Restitué',
  cloture: 'Clôturé',
  annule: 'Annulé',
};

describe('BadgeStatutOr', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('couvre les 12 valeurs de EtatAfficheOrdreReparation (mapping exhaustif, y compris les 3 attentes)', () => {
    expect(ETATS_AFFICHES_ORDRE_REPARATION).toHaveLength(12);
    for (const etat of ETATS_AFFICHES_ORDRE_REPARATION) {
      const { unmount } = render(<BadgeStatutOr etat={etat} />);
      expect(screen.getByText(MOTS_FR[etat])).toBeInTheDocument();
      unmount();
    }
  });

  it('rend les trois drapeaux d’attente — absents de StatutOrdreReparation, seule raison d’exister de ce composant', () => {
    render(<BadgeStatutOr etat="attente_pieces" />);
    expect(screen.getByText('Attente pièces')).toBeInTheDocument();
  });

  it('traduit le mot en allemand', async () => {
    await i18n.changeLanguage('de');
    render(<BadgeStatutOr etat="en_cours" />);
    expect(screen.getByText('In Bearbeitung')).toBeInTheDocument();
  });
});
