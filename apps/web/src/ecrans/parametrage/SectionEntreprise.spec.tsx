import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { SectionEntreprise } from './SectionEntreprise';

const CHEMIN = '/api/v1/parametres-entreprise';

function rendre() {
  return render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <MemoryRouter>
        <SectionEntreprise />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SectionEntreprise', () => {
  it('affiche la raison sociale en lecture seule et le n° TVA actuel', async () => {
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json({ raisonSociale: 'Garage Martin SA', numeroTva: 'CHE-116.281.710 TVA' }),
      ),
    );
    rendre();
    const raison = await screen.findByLabelText(i18n.t('parametrage:entreprise.raisonSociale'));
    expect(raison).toHaveValue('Garage Martin SA');
    expect(raison).toHaveAttribute('readonly');
    expect(screen.getByLabelText(i18n.t('parametrage:entreprise.numeroTva'))).toHaveValue(
      'CHE-116.281.710 TVA',
    );
  });

  it('refuse un numéro mal formé AVANT tout appel API, sans perdre la saisie', async () => {
    let appels = 0;
    server.use(
      http.get(CHEMIN, () => HttpResponse.json({ raisonSociale: 'G', numeroTva: null })),
      http.patch(CHEMIN, () => {
        appels += 1;
        return HttpResponse.json({ raisonSociale: 'G', numeroTva: null });
      }),
    );
    rendre();
    const champ = await screen.findByLabelText(i18n.t('parametrage:entreprise.numeroTva'));
    await userEvent.type(champ, 'CHE-123');
    await userEvent.click(
      screen.getByRole('button', { name: i18n.t('parametrage:entreprise.enregistrer') }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      i18n.t('parametrage:entreprise.erreurTva.format'),
    );
    expect(champ).toHaveValue('CHE-123');
    expect(appels).toBe(0);
  });

  it('numéro valide : PATCH avec le numéro normalisé, puis confirmation', async () => {
    let corps: unknown;
    server.use(
      http.get(CHEMIN, () => HttpResponse.json({ raisonSociale: 'G', numeroTva: null })),
      http.patch(CHEMIN, async ({ request }) => {
        corps = await request.json();
        return HttpResponse.json({ raisonSociale: 'G', numeroTva: 'CHE-116.281.710 TVA' });
      }),
    );
    rendre();
    const champ = await screen.findByLabelText(i18n.t('parametrage:entreprise.numeroTva'));
    await userEvent.type(champ, 'che-116.281.710 tva');
    await userEvent.click(
      screen.getByRole('button', { name: i18n.t('parametrage:entreprise.enregistrer') }),
    );

    expect(
      await screen.findByText(i18n.t('parametrage:entreprise.enregistrementReussi')),
    ).toBeInTheDocument();
    expect(corps).toEqual({ numeroTva: 'CHE-116.281.710 TVA' });
  });

  it('champ vidé : envoie null (efface le numéro)', async () => {
    let corps: unknown;
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json({ raisonSociale: 'G', numeroTva: 'CHE-116.281.710 TVA' }),
      ),
      http.patch(CHEMIN, async ({ request }) => {
        corps = await request.json();
        return HttpResponse.json({ raisonSociale: 'G', numeroTva: null });
      }),
    );
    rendre();
    const champ = await screen.findByLabelText(i18n.t('parametrage:entreprise.numeroTva'));
    await userEvent.clear(champ);
    await userEvent.click(
      screen.getByRole('button', { name: i18n.t('parametrage:entreprise.enregistrer') }),
    );
    await waitFor(() => expect(corps).toEqual({ numeroTva: null }));
  });

  it('erreur de chargement : message actionnable avec Réessayer', async () => {
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json(
          { type: 'about:blank', title: 'x', status: 500, code: 'ERREUR_INTERNE', instance: '/x' },
          { status: 500, headers: { 'Content-Type': 'application/problem+json' } },
        ),
      ),
    );
    rendre();
    expect(
      await screen.findByText(i18n.t('parametrage:entreprise.erreur.titre')),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /réessayer/i })).toBeInTheDocument();
  });
});
