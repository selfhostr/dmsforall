import type { ReponseContexteAtelier } from '@dfa/shared';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { EncartAlertesVehicule } from './EncartAlertesVehicule';

// Fixture `contexte-atelier` (§8.1) — les six familles toutes renseignées.
const CONTEXTE: ReponseContexteAtelier = {
  vehicule: {
    id: 'v1',
    plaque: '123456',
    canton: 'VD',
    designation: 'VW Touran 2.0 TDI',
    premiereMiseEnCirculationLe: '2018-03-14',
    vin: 'WVGZZZ1TZ8W123456',
    codeTypeCh: null,
    importe: { estImporte: true, paysOrigine: 'DE', importeLe: '2019-02-01' },
    identificationIncomplete: false,
  },
  detenteurCourant: null,
  dernierKilometrage: null,
  expertise: {
    derniereLe: '2022-05-01',
    prochaineLe: '2026-08-01',
    source: 'convocation',
    echue: true,
    joursDepuisEcheance: 12,
  },
  garantie: {
    constructeur: { debutLe: '2024-01-01', finLe: '2027-01-01', plafondKm: 100000, active: true },
    garage: null,
  },
  campagnesOuvertes: [
    { id: 'camp1', code: 'RC-2026-04', description: 'Rappel airbag', obligatoire: true },
  ],
  travauxReportes: {
    total: 1,
    elements: [
      {
        id: 't1',
        designation: 'Plaquettes de frein avant',
        urgence: 'urgent',
        montantEstimeCentimes: 24000,
        kilometrageAlors: 85000,
        constateLe: '2026-01-15',
        securite: true,
        statut: 'ouvert',
        ordreReparationOrigineId: null,
        ligneOrOrigineId: null,
        ordreReparationRepriseId: null,
        motifModification: null,
      },
    ],
  },
  alertesClient: [{ id: 'al1', nature: 'alerte', texte: 'Paie toujours en retard' }],
  ordresReparationOuverts: [],
  depotPneus: null,
  avertissements: [],
};

function proprietes(surcharges: Partial<Parameters<typeof EncartAlertesVehicule>[0]> = {}) {
  return {
    travauxReportes: CONTEXTE.travauxReportes,
    campagnesOuvertes: CONTEXTE.campagnesOuvertes,
    expertise: CONTEXTE.expertise,
    garantie: CONTEXTE.garantie,
    importe: CONTEXTE.vehicule.importe,
    alertesClient: CONTEXTE.alertesClient,
    ...surcharges,
  };
}

describe('EncartAlertesVehicule', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('rend les six familles depuis la fixture contexte-atelier', () => {
    render(<EncartAlertesVehicule {...proprietes()} />);
    expect(screen.getByText('Paie toujours en retard')).toBeInTheDocument(); // alerte client
    expect(screen.getByText(/Rappel airbag/)).toBeInTheDocument(); // campagne
    expect(screen.getByText(/Plaquettes de frein avant/)).toBeInTheDocument(); // travail reporté
    expect(screen.getByText(/01\.08\.2026/)).toBeInTheDocument(); // expertise
    expect(screen.getByText(/100'000 km/)).toBeInTheDocument(); // garantie
    expect(screen.getByText('Véhicule importé')).toBeInTheDocument(); // importé
  });

  it('fait disparaître une famille vide, sans jamais afficher « 0 »', () => {
    render(
      <EncartAlertesVehicule
        {...proprietes({
          travauxReportes: { total: 0, elements: [] },
          campagnesOuvertes: [],
          alertesClient: [],
        })}
      />,
    );
    expect(screen.queryByText(/Travaux reportés/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Rappel airbag/)).not.toBeInTheDocument();
    expect(screen.queryByText('Paie toujours en retard')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it("ne rend rien quand aucune des six familles n'a de contenu", () => {
    const { container } = render(
      <EncartAlertesVehicule
        {...proprietes({
          travauxReportes: { total: 0, elements: [] },
          campagnesOuvertes: [],
          alertesClient: [],
          expertise: null,
          garantie: { constructeur: null, garage: null },
          importe: { estImporte: false, paysOrigine: null, importeLe: null },
        })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("n'appelle jamais l'API — onAjouter est un pur événement UI transmis à l'appelant", async () => {
    const onAjouter = vi.fn();
    const utilisateur = userEvent.setup();
    render(<EncartAlertesVehicule {...proprietes()} onAjouter={onAjouter} />);
    // Deux éléments addables dans cette fixture : la campagne (rendue en premier) et le travail
    // reporté (rendu ensuite) — voir l'ordre de construction des lignes dans le composant.
    const boutons = screen.getAllByRole('button', { name: 'Ajouter à ce RDV' });
    expect(boutons).toHaveLength(2);
    await utilisateur.click(boutons[0]!);
    expect(onAjouter).toHaveBeenCalledWith({
      famille: 'campagne',
      item: CONTEXTE.campagnesOuvertes[0],
    });
  });

  it('omet le bouton « Ajouter » quand onAjouter est omis', () => {
    render(<EncartAlertesVehicule {...proprietes()} />);
    expect(screen.queryByRole('button', { name: 'Ajouter à ce RDV' })).not.toBeInTheDocument();
  });

  it('traduit le libellé « Alertes & opportunités » en allemand', async () => {
    await i18n.changeLanguage('de');
    render(<EncartAlertesVehicule {...proprietes()} />);
    expect(screen.getByText('Alerts & Chancen')).toBeInTheDocument();
  });

  // Issue #83 : « Expertise prochaine » et « Échue » ne se disent jamais du même mot, et le rouge
  // (`token: 'danger'`) est réservé à ce qui exige une action — trois états distincts, jamais deux
  // confondus dans la même ligne (règle « absence de donnée ≠ valeur »).
  describe('trois états de l’expertise (issue #83)', () => {
    it('expertise ÉCHUE : titre « Expertise échue », cadre rouge, jamais « Expertise prochaine »', () => {
      render(<EncartAlertesVehicule {...proprietes()} />); // fixture CONTEXTE.expertise.echue = true
      expect(screen.getByText('Expertise échue')).toBeInTheDocument();
      expect(screen.queryByText('Expertise prochaine')).not.toBeInTheDocument();
      const ligne = screen.getByText('Expertise échue').closest('div.rounded-md');
      expect(ligne).toHaveClass('border-statut-danger');
    });

    it('expertise À VENIR (non échue) : titre « Expertise prochaine », cadre attention (orange), jamais « Échue »', () => {
      render(
        <EncartAlertesVehicule
          {...proprietes({
            expertise: {
              ...(CONTEXTE.expertise as NonNullable<typeof CONTEXTE.expertise>),
              echue: false,
              prochaineLe: '2027-01-15',
            },
          })}
        />,
      );
      expect(screen.getByText('Expertise prochaine')).toBeInTheDocument();
      expect(screen.queryByText('Expertise échue')).not.toBeInTheDocument();
      const ligne = screen.getByText('Expertise prochaine').closest('div.rounded-md');
      expect(ligne).toHaveClass('border-statut-attention');
      expect(ligne).not.toHaveClass('border-statut-danger');
    });

    it('AUCUNE expertise connue : aucune ligne « Expertise » — absence de donnée, jamais une valeur inventée', () => {
      render(<EncartAlertesVehicule {...proprietes({ expertise: null })} />);
      expect(screen.queryByText('Expertise prochaine')).not.toBeInTheDocument();
      expect(screen.queryByText('Expertise échue')).not.toBeInTheDocument();
      // Les cinq autres familles de cette fixture restent affichées — seule l'expertise disparaît.
      expect(screen.getByText('Paie toujours en retard')).toBeInTheDocument();
    });
  });
});
