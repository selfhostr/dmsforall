import type { ReponseVehiculeDetention } from '@dfa/shared';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { FriseDetentions } from './FriseDetentions';

const DETENTION_COURANTE: ReponseVehiculeDetention = {
  id: 'd1',
  client: { id: 'c1', numeroClient: 'CL-042', nomAffiche: 'Hans Meier' },
  debutLe: '2024-06-01',
  finLe: null,
  motifFin: null,
};

const DETENTION_PASSEE: ReponseVehiculeDetention = {
  id: 'd0',
  client: { id: 'c0', numeroClient: 'CL-010', nomAffiche: 'Maria Rossi' },
  debutLe: '2020-01-01',
  finLe: '2024-06-01',
  motifFin: 'vente',
};

describe('FriseDetentions', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('distingue le détenteur courant (finLe null) des détentions passées', () => {
    render(<FriseDetentions detentions={[DETENTION_COURANTE, DETENTION_PASSEE]} />);
    expect(screen.getByText('Hans Meier')).toBeInTheDocument();
    expect(screen.getByText('Maria Rossi')).toBeInTheDocument();
    expect(screen.getByText('Détenteur actuel')).toBeInTheDocument();
    expect(screen.getByText('Vente')).toBeInTheDocument();
  });

  it('affiche un état vide en l’absence de détention', () => {
    render(<FriseDetentions detentions={[]} />);
    expect(screen.getByText('Détention')).toBeInTheDocument();
  });

  it('traduit le motif de fin en allemand', async () => {
    await i18n.changeLanguage('de');
    render(<FriseDetentions detentions={[DETENTION_PASSEE]} />);
    expect(screen.getByText('Verkauf')).toBeInTheDocument();
  });
});
