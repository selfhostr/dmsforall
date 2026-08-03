import type { ResultatRecherche } from '@dfa/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { ResultatClient } from './ResultatClient';

const RESULTAT_CLIENT: ResultatRecherche = {
  type: 'client',
  id: 'c1',
  score: 0.88,
  correspondance: { champ: 'nom', valeur: 'Meier', historique: false },
  resume: {
    numeroClient: 'CL-042',
    nom: 'Meier Hans',
    telephone: '079 123 45 67',
    localite: 'Lausanne',
  },
};

describe('ResultatClient', () => {
  it('affiche le nom, le numéro client, le téléphone et la localité', () => {
    render(<ResultatClient resultat={RESULTAT_CLIENT} />);
    expect(screen.getByText('Meier Hans')).toBeInTheDocument();
    expect(screen.getByText('CL-042')).toBeInTheDocument();
    expect(screen.getByText('079 123 45 67')).toBeInTheDocument();
    expect(screen.getByText('Lausanne')).toBeInTheDocument();
  });

  it('omet les champs absents du résumé sans planter', () => {
    render(<ResultatClient resultat={{ ...RESULTAT_CLIENT, resume: { nom: 'Rossi Maria' } }} />);
    expect(screen.getByText('Rossi Maria')).toBeInTheDocument();
  });
});
