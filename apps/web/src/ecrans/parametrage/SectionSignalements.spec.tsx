import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { SectionSignalements } from './SectionSignalements';

const CHEMIN = '/api/v1/parametres-entreprise';
const BASE = {
  raisonSociale: 'G',
  assujettiTva: true,
  numeroTva: null,
  delaiPaiementJoursDefaut: 30,
  modeSignalement: 'via_site',
};

describe('SectionSignalements', () => {
  it('coche le mode actuel du garage', async () => {
    server.use(
      http.get(CHEMIN, () => HttpResponse.json({ ...BASE, modeSignalement: 'copie_seule' })),
    );
    render(
      <QueryClientProvider client={creerQueryClientTest()}>
        <SectionSignalements />
      </QueryClientProvider>,
    );
    const copie = await screen.findByRole('radio', {
      name: i18n.t('parametrage:signalements.modes.copie_seule'),
    });
    expect(copie).toBeChecked();
  });

  it('un choix est enregistré tout de suite, avec ce seul champ', async () => {
    let corps: unknown;
    server.use(
      http.get(CHEMIN, () => HttpResponse.json(BASE)),
      http.patch(CHEMIN, async ({ request }) => {
        corps = await request.json();
        return HttpResponse.json({ ...BASE, modeSignalement: 'desactive' });
      }),
    );
    render(
      <QueryClientProvider client={creerQueryClientTest()}>
        <SectionSignalements />
      </QueryClientProvider>,
    );
    await userEvent.click(
      await screen.findByRole('radio', {
        name: i18n.t('parametrage:signalements.modes.desactive'),
      }),
    );
    expect(
      await screen.findByText(i18n.t('parametrage:signalements.enregistre')),
    ).toBeInTheDocument();
    expect(corps).toEqual({ modeSignalement: 'desactive' });
  });
});
