import type { ResultatRecherche } from '@dfa/shared';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { ResultatOr } from './ResultatOr';

const RESULTAT_OR: ResultatRecherche = {
  type: 'ordre_reparation',
  id: 'or1',
  score: 0.99,
  correspondance: { champ: 'numero', valeur: 'OR-2026-1042', historique: false },
  resume: { numero: '2026-1042', statut: 'attente_pieces', plaque: 'VD 123456', designationVehicule: 'VW Touran' },
};

describe('ResultatOr', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('affiche le numéro (format OR-xxx), le statut affiché et le véhicule', () => {
    render(<ResultatOr resultat={RESULTAT_OR} />);
    expect(screen.getByText('OR-2026-1042')).toBeInTheDocument();
    expect(screen.getByText('Attente pièces')).toBeInTheDocument();
    expect(screen.getByText('VD 123456')).toBeInTheDocument();
    expect(screen.getByText('VW Touran')).toBeInTheDocument();
  });

  it('traduit le statut affiché en allemand', async () => {
    await i18n.changeLanguage('de');
    render(<ResultatOr resultat={RESULTAT_OR} />);
    expect(screen.getByText('Wartet auf Teile')).toBeInTheDocument();
  });
});
