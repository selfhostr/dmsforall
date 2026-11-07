import type { ResultatRecherche } from '@dfa/shared';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { ResultatDocumentVente } from './ResultatDocumentVente';

const RESULTAT_FACTURE: ResultatRecherche = {
  type: 'document_vente',
  id: 'dv1',
  score: 0.98,
  correspondance: { champ: 'numero', valeur: 'F-2026-0312', historique: false },
  resume: {
    numero: 'F-2026-0312',
    typeDocument: 'facture',
    clientNom: 'Garage Martin',
    dateDocument: '2026-11-06',
  },
};

describe('ResultatDocumentVente', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('affiche la date du document au format suisse jj.mm.aaaa, jamais en ISO', () => {
    render(<ResultatDocumentVente resultat={RESULTAT_FACTURE} />);
    expect(screen.getByText('06.11.2026')).toBeInTheDocument();
    expect(screen.queryByText('2026-11-06')).not.toBeInTheDocument();
  });
});
