import type { ClientResume } from '@dfa/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '@/i18n';

import { IdentiteClient } from './IdentiteClient';

const CLIENT: ClientResume = {
  id: 'c1',
  numeroClient: 'CL-00042',
  nomAffiche: 'Garage Martin Sàrl',
  type: 'entreprise',
  statut: 'actif',
  langueCorrespondance: 'fr',
  poObligatoire: false,
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
