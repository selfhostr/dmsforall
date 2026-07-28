import type { ClientResume } from '@dfa/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { IdentiteClient } from './IdentiteClient';

// Client créé à la volée au comptoir : fiche fraîche, sans téléphone ni adresse encore saisis,
// aucun véhicule rattaché. C'est le cas le plus fréquent sur les fiches récentes — `IdentiteClient`
// ne doit rien en faire planter ni afficher un `undefined`/tiret ambigu.
const CLIENT: ClientResume = {
  id: 'c1',
  numeroClient: 'CL-00042',
  nomAffiche: 'Garage Martin Sàrl',
  type: 'entreprise',
  statut: 'actif',
  langueCorrespondance: 'fr',
  poObligatoire: false,
  telephone: null,
  localite: null,
  nombreVehicules: 0,
  dernierPassageLe: null,
};

describe('IdentiteClient', () => {
  it('affiche le nom affiché et le numéro de client', () => {
    render(<IdentiteClient client={CLIENT} />);
    expect(screen.getByText('Garage Martin Sàrl')).toBeInTheDocument();
    expect(screen.getByText('CL-00042')).toBeInTheDocument();
  });

  it("n'affiche aucun badge de statut pour un client actif", () => {
    render(<IdentiteClient client={CLIENT} />);
    expect(screen.queryByText('Actif')).not.toBeInTheDocument();
  });

  it('intègre le badge « Bloqué » pour un client bloqué (impayés, RM-08)', () => {
    render(<IdentiteClient client={{ ...CLIENT, statut: 'bloque' }} />);
    expect(screen.getByText('Bloqué')).toBeInTheDocument();
  });

  it('intègre le badge alerte quand `alerte` est vrai', () => {
    render(<IdentiteClient client={CLIENT} alerte />);
    expect(screen.getByText('Alerte client')).toBeInTheDocument();
  });
});
