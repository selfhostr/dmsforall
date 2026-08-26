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
    // max = SOMME de tous les statuts (2+4+8+0+1+3 = 18), pas le plus chargé d'entre eux — sinon
    // « en cours » (8) afficherait toujours 100 % quelle que soit la charge réelle de l'atelier.
    expect(jaugeEnCours).toHaveAttribute('aria-valuemax', '18');

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

  /**
   * Dénominateur — régression du bug mesuré : le calcul prenait `Math.max(...valeurs)` (le
   * statut le plus chargé) au lieu de la SOMME de tous les statuts. Conséquence : le statut
   * majoritaire affichait toujours 100 % (`max === lui-même`), et les autres barres montraient
   * leur proportion par rapport à LUI, pas par rapport au total réel de l'atelier — des
   * proportions fausses à l'écran. Valeurs exactes ci-dessous, jamais `toBeCloseTo` (convention
   * du dépôt sur l'arithmétique).
   */
  describe('dénominateur — somme de tous les statuts, pas le plus chargé', () => {
    it("un statut ne peut plus revendiquer 100 % simplement parce qu'il est le plus chargé", async () => {
      render(<CarteRepartitionStatuts resultat={resultat()} />);

      // Total réel : 2 + 4 + 8 + 0 + 1 + 3 = 18. Avant le correctif, `max` valait 8 (le nombre de
      // « en cours ») et CE statut affichait 8/8 = 100 %. Avec le bon dénominateur, sa part réelle
      // est 8/18 ≈ 44 % — le test qui compte est la valeur `aria-valuemax`, identique pour TOUTES
      // les jauges (le total), jamais recalculée par jauge.
      const jauges = await screen.findAllByRole('meter');
      expect(jauges).toHaveLength(6);
      for (const jauge of jauges) {
        expect(jauge).toHaveAttribute('aria-valuemax', '18');
      }

      const jaugeOuvert = screen.getByRole('meter', { name: 'Ouvert' });
      expect(jaugeOuvert).toHaveAttribute('aria-valuenow', '4');
      // Avant le correctif, la barre « ouvert » (4) se serait affichée à 4/8 = 50 % de la largeur
      // (relative au statut le plus chargé). Avec la somme, sa proportion réelle est 4/18 ≈ 22 %
      // — non mesurable en pixels ici (jsdom, `css: false`), mais la paire valeur/max ci-dessus
      // est exactement ce que `Meter` (`@base-ui/react/meter`) utilise pour calculer la largeur
      // rendue : value=4, max=18, jamais max=8.
    });

    it('total nul : aucune barre à 100 %, pas de division par zéro (pas de NaN)', async () => {
      const donneesTotalNul = {
        ...DONNEES_ACTIVITE,
        ordresReparationParStatut: DONNEES_ACTIVITE.ordresReparationParStatut.map((ligne) => ({
          ...ligne,
          nombre: 0,
        })),
      } as unknown as ReponseActiviteTableauBord;

      render(<CarteRepartitionStatuts resultat={resultat({ data: donneesTotalNul })} />);

      const jauges = await screen.findAllByRole('meter');
      expect(jauges).toHaveLength(6);
      for (const jauge of jauges) {
        expect(jauge).toHaveAttribute('aria-valuenow', '0');
        // Dénominateur protégé (`Math.max(1, total)`) : jamais 0, jamais `NaN`/absent.
        expect(jauge).toHaveAttribute('aria-valuemax', '1');
        expect(jauge.getAttribute('aria-valuemax')).not.toBe('0');
        expect(jauge.getAttribute('aria-valuenow')).not.toBe('NaN');
      }
    });

    it('un seul statut non nul : lui seul à 100 %, les autres restent à 0 (zéro-digne)', async () => {
      const donneesUnSeulStatut = {
        ...DONNEES_ACTIVITE,
        ordresReparationParStatut: DONNEES_ACTIVITE.ordresReparationParStatut.map((ligne) => ({
          ...ligne,
          nombre: ligne.statut === 'termine' ? 5 : 0,
        })),
      } as unknown as ReponseActiviteTableauBord;

      render(<CarteRepartitionStatuts resultat={resultat({ data: donneesUnSeulStatut })} />);

      const jaugeTermine = screen.getByRole('meter', { name: 'Terminé' });
      expect(jaugeTermine).toHaveAttribute('aria-valuenow', '5');
      // Total = 5 (un seul statut non nul) : cette jauge affiche bien 100 % de la charge réelle,
      // ce n'est plus un artefact du calcul (`max` = ce même statut par construction du bug), mais
      // le reflet exact de la réalité — tous les autres OR sont ailleurs, ce statut porte tout.
      expect(jaugeTermine).toHaveAttribute('aria-valuemax', '5');

      const autresJauges = screen.getAllByRole('meter').filter((jauge) => jauge !== jaugeTermine);
      expect(autresJauges).toHaveLength(5);
      for (const jauge of autresJauges) {
        expect(jauge).toHaveAttribute('aria-valuenow', '0');
        expect(jauge).toHaveAttribute('aria-valuemax', '5');
      }
    });
  });
});
