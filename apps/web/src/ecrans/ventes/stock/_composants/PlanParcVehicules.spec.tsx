import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { VehiculeStockResume } from '@dfa/shared';

import '@/i18n';

import { grouperVehiculesParEmplacement, PlanParcVehicules } from './PlanParcVehicules';

function creerVehiculeStock(overrides: Partial<VehiculeStockResume> = {}): VehiculeStockResume {
  const id = overrides.id ?? crypto.randomUUID();
  return {
    id,
    provenance: 'achat_particulier',
    typeVehicule: 'vo',
    statutCommercial: 'disponible',
    prixVenteAfficheCentimes: 1_500_000,
    joursStock: 12,
    vehicule: {
      id,
      plaque: '123456',
      canton: 'VD',
      designation: 'VW Golf 2.0 TDI',
      vin: 'WVWZZZ1KZAP123456',
      premiereMiseEnCirculationLe: '2019-01-01',
      identificationIncomplete: false,
      emplacementLibre: null,
    },
    ...overrides,
  };
}

describe('grouperVehiculesParEmplacement', () => {
  it('regroupe par emplacement, trié alphabétiquement, « sans emplacement » en dernier', () => {
    const vehicules = [
      creerVehiculeStock({
        vehicule: { ...creerVehiculeStock().vehicule, emplacementLibre: 'Place 3' },
      }),
      creerVehiculeStock({
        vehicule: { ...creerVehiculeStock().vehicule, emplacementLibre: null },
      }),
      creerVehiculeStock({
        vehicule: { ...creerVehiculeStock().vehicule, emplacementLibre: 'Devant' },
      }),
      creerVehiculeStock({
        vehicule: { ...creerVehiculeStock().vehicule, emplacementLibre: '   ' },
      }),
    ];

    const groupes = grouperVehiculesParEmplacement(vehicules);

    expect(groupes.map((g) => g.libelle)).toEqual(['Devant', 'Place 3', null]);
    // Le groupe « sans emplacement » (libellé null) rassemble null ET la chaîne blanche.
    expect(groupes.at(-1)?.vehicules).toHaveLength(2);
  });

  it("n'ajoute pas de groupe « sans emplacement » si tous les véhicules sont placés", () => {
    const vehicules = [
      creerVehiculeStock({
        vehicule: { ...creerVehiculeStock().vehicule, emplacementLibre: 'Devant' },
      }),
    ];

    const groupes = grouperVehiculesParEmplacement(vehicules);

    expect(groupes).toHaveLength(1);
    expect(groupes[0]?.libelle).toBe('Devant');
  });

  it('rend une liste vide sur un parc vide', () => {
    expect(grouperVehiculesParEmplacement([])).toEqual([]);
  });
});

describe('<PlanParcVehicules />', () => {
  it('affiche le contenu vide fourni quand le parc filtré est vide', () => {
    render(
      <PlanParcVehicules
        vehiculesStock={[]}
        onOuvrirVehicule={vi.fn()}
        libelleOuvrirVehicule={() => 'ouvrir'}
        contenuVide={<p>Aucun véhicule ici</p>}
      />,
    );

    expect(screen.getByText('Aucun véhicule ici')).toBeInTheDocument();
  });

  it('affiche une zone par emplacement et un groupe « Sans emplacement » distinct', () => {
    const vehicules = [
      creerVehiculeStock({
        id: 'v1',
        vehicule: {
          ...creerVehiculeStock().vehicule,
          emplacementLibre: 'Devant',
          plaque: '111111',
        },
      }),
      creerVehiculeStock({
        id: 'v2',
        vehicule: { ...creerVehiculeStock().vehicule, emplacementLibre: null, plaque: '222222' },
      }),
    ];

    render(
      <PlanParcVehicules
        vehiculesStock={vehicules}
        onOuvrirVehicule={vi.fn()}
        libelleOuvrirVehicule={() => 'ouvrir'}
        contenuVide={<p>vide</p>}
      />,
    );

    const zones = screen.getAllByRole('listitem');
    expect(zones).toHaveLength(2);
    expect(within(zones[0]!).getByText('Devant')).toBeInTheDocument();
    expect(within(zones[1]!).getByText('Sans emplacement')).toBeInTheDocument();
  });

  it('ouvre le véhicule cliqué', async () => {
    const onOuvrirVehicule = vi.fn();
    const vehicules = [
      creerVehiculeStock({
        id: 'v1',
        vehicule: { ...creerVehiculeStock().vehicule, emplacementLibre: 'Devant' },
      }),
    ];

    render(
      <PlanParcVehicules
        vehiculesStock={vehicules}
        onOuvrirVehicule={onOuvrirVehicule}
        libelleOuvrirVehicule={() => 'ouvrir ce véhicule'}
        contenuVide={<p>vide</p>}
      />,
    );

    screen.getByRole('button', { name: 'ouvrir ce véhicule' }).click();
    expect(onOuvrirVehicule).toHaveBeenCalledWith('v1');
  });
});
