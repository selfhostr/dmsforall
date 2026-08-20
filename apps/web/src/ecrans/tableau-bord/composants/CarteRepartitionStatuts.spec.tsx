import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ReponseActiviteTableauBord } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import type { ResultatChiffreTableauBord } from './CarteChiffreRequete';
import { CarteRepartitionStatuts } from './CarteRepartitionStatuts';

const DONNEES_ACTIVITE = {
  periode: { debut: '2026-08-01', fin: '2026-08-16' },
  siteId: null,
  ordresReparationParStatut: [
    { statut: 'planifie', nombre: 2 },
    { statut: 'ouvert', nombre: 4 },
    { statut: 'en_cours', nombre: 8 },
    { statut: 'controle', nombre: 0 },
    { statut: 'termine', nombre: 1 },
    { statut: 'facture', nombre: 3 },
  ],
  ordresReparationOuvertsPeriode: 0,
  ordresReparationRestituesPeriode: 0,
  delaiMoyenRestitutionHeures: null,
} as unknown as ReponseActiviteTableauBord;

function resultat(
  overrides: Partial<ResultatChiffreTableauBord<ReponseActiviteTableauBord>> = {},
): ResultatChiffreTableauBord<ReponseActiviteTableauBord> {
  return {
    data: DONNEES_ACTIVITE,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

/**
 * Démonstration coss/Base UI (`components/ui/meter.tsx`, cf. CONTRIBUTING.md). Le point vérifié n'est
 * pas visuel — RTL ne mesure pas des pixels — mais le rôle ARIA que l'ancienne barre maison
 * (`aria-hidden="true"` sur toute la piste) ne portait pas : `role="meter"` avec
 * `aria-valuenow/min/max` corrects par statut, exposé aussi bien en français qu'en allemand.
 */
describe('CarteRepartitionStatuts', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('expose un rôle meter accessible par statut, avec la bonne valeur/plage', async () => {
    render(<CarteRepartitionStatuts resultat={resultat()} />);

    // `findBy*` attend le rendu à deux passes de Base UI (liaison `aria-labelledby` posée après
    // montage, voir `components/ui/meter.tsx`) — un `getBy*` déclencherait l'avertissement React
    // « update not wrapped in act ».
    const jaugeEnCours = await screen.findByRole('meter', { name: 'En cours' });
    expect(jaugeEnCours).toHaveAttribute('aria-valuenow', '8');
    expect(jaugeEnCours).toHaveAttribute('aria-valuemin', '0');
    // max = plus grand nombre parmi les statuts (8, ici « en cours »)
    expect(jaugeEnCours).toHaveAttribute('aria-valuemax', '8');

    expect(screen.getAllByRole('meter')).toHaveLength(6);
  });

  it('garde un statut à 0 visible et mesurable — doctrine zéro-digne', async () => {
    render(<CarteRepartitionStatuts resultat={resultat()} />);

    const jaugeControle = await screen.findByRole('meter', { name: 'Contrôle' });
    expect(jaugeControle).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('Contrôle')).toBeInTheDocument();
  });

  it('nomme la jauge dans la langue active — bascule allemande', async () => {
    await i18n.changeLanguage('de');
    render(<CarteRepartitionStatuts resultat={resultat()} />);

    expect(await screen.findByRole('meter', { name: 'In Bearbeitung' })).toBeInTheDocument();
  });

  it('affiche un état de chargement quand la requête est en attente', () => {
    render(<CarteRepartitionStatuts resultat={resultat({ data: undefined, isPending: true })} />);

    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
  });
});
