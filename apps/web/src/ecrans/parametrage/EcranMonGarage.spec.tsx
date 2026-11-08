import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranMonGarage } from './EcranMonGarage';

const CHEMIN = '/api/v1/parametres-facturation/creancier';
const avecEtoile = (libelle: string) =>
  new RegExp(`^${libelle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*?$`);

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const BLOC_VIDE = {
  nom: null,
  rue: null,
  numero: null,
  npa: null,
  localite: null,
  pays: 'CH',
  iban: null,
  qrIban: null,
  version: 0,
};

function rendre() {
  server.use(
    http.get('/api/v1/parametres-entreprise', () =>
      HttpResponse.json({
        raisonSociale: 'Garage Martin SA',
        numeroTva: null,
        delaiPaiementJoursDefaut: 30,
      }),
    ),
  );
  return render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <MemoryRouter>
        <EcranMonGarage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranMonGarage', () => {
  it('affiche la légende, le bandeau « À compléter » et marque nom et adresse obligatoires', async () => {
    server.use(http.get(CHEMIN, () => HttpResponse.json(BLOC_VIDE)));
    rendre();

    expect(
      await screen.findByText(i18n.t('parametrage:garage.aCompleter.adresse')),
    ).toBeInTheDocument();
    expect(screen.getByText(i18n.t('parametrage:obligatoire.legende'))).toBeInTheDocument();
    expect(
      await screen.findByLabelText(avecEtoile(i18n.t('parametrage:entreprise.raisonSociale'))),
    ).toHaveAttribute('aria-required', 'true');
    for (const cle of ['rue', 'numero', 'npa', 'localite', 'pays']) {
      expect(
        screen.getByLabelText(avecEtoile(i18n.t(`parametrage:creancier.adresse.${cle}`))),
      ).toHaveAttribute('aria-required', 'true');
    }
  });

  it('adresse complète : pas de bandeau ; enregistrer envoie la seule adresse', async () => {
    let corps: Record<string, unknown> | undefined;
    server.use(
      http.get(CHEMIN, () =>
        HttpResponse.json({
          ...BLOC_VIDE,
          rue: 'Rue de la Gare',
          numero: '12',
          npa: '1000',
          localite: 'Lausanne',
          version: 1,
        }),
      ),
      http.patch(CHEMIN, async ({ request }) => {
        corps = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...BLOC_VIDE, ...corps, version: 2 });
      }),
    );
    rendre();

    const rue = await screen.findByLabelText(
      avecEtoile(i18n.t('parametrage:creancier.adresse.rue')),
    );
    expect(
      screen.queryByText(i18n.t('parametrage:garage.aCompleter.titre')),
    ).not.toBeInTheDocument();
    const u = userEvent.setup();
    await u.clear(rue);
    await u.type(rue, 'Avenue du Lac');
    const boutons = screen.getAllByRole('button', { name: i18n.t('commun:actions.enregistrer') });
    await u.click(boutons[boutons.length - 1]!);

    expect(
      await screen.findByText(i18n.t('parametrage:creancier.enregistrementReussi')),
    ).toBeInTheDocument();
    expect(corps).toMatchObject({ rue: 'Avenue du Lac', npa: '1000', pays: 'CH' });
    expect(corps).not.toHaveProperty('iban');
    expect(corps).not.toHaveProperty('nom');
  });
});
