import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import type { ClientResume, OrdreReparationResume, VehiculeResume } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { BandeauPrioriteTableauBord } from './BandeauPrioriteTableauBord';

const CHEMIN_OR = '/api/v1/ordres-reparation';
const CHEMIN_FINANCIER = '/api/v1/tableau-bord/financier';
const PAGE_VIDE = { donnees: [], curseurSuivant: null, limite: 100 };

const CLIENT_TEST: ClientResume = {
  id: 'client-1',
  numeroClient: 'C-1',
  nomAffiche: 'Jean Dupont',
  type: 'particulier',
  statut: 'actif',
  langueCorrespondance: 'fr',
  poObligatoire: false,
  telephone: null,
  localite: null,
  nombreVehicules: 1,
  dernierPassageLe: null,
};

const VEHICULE_TEST: VehiculeResume = {
  id: 'vehicule-1',
  plaque: 'VD 123456',
  canton: 'VD',
  designation: 'VW Golf',
  vin: null,
  premiereMiseEnCirculationLe: null,
  identificationIncomplete: false,
  emplacementLibre: null,
};

function construireOrResume(overrides: Partial<OrdreReparationResume>): OrdreReparationResume {
  return {
    id: 'or-1',
    numero: 'OR-2026-000123',
    statut: 'ouvert',
    etatAffiche: 'ouvert',
    type: 'reparation',
    localisation: 'atelier',
    ouvertLe: '2026-08-10T08:00:00.000Z',
    restitutionPromiseLe: new Date().toISOString(),
    vehicule: VEHICULE_TEST,
    client: CLIENT_TEST,
    nombreLignes: 1,
    ...overrides,
  };
}

function rendre(role: Parameters<typeof BandeauPrioriteTableauBord>[0]['role'], site = 'site-1') {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <BandeauPrioriteTableauBord role={role} site={site} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('BandeauPrioriteTableauBord', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('aucun OR en retard : ne se rend pas du tout (jamais un bandeau « tout va bien »)', async () => {
    server.use(http.get(CHEMIN_OR, () => HttpResponse.json(PAGE_VIDE)));
    const { container } = rendre('direction');

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container).toBeEmptyDOMElement();
  });

  it('rôle sans accès aux OR (magasinier, comptable) : absent, et ne déclenche AUCUNE requête', async () => {
    let appelsOr = 0;
    let appelsFinancier = 0;
    server.use(
      http.get(CHEMIN_OR, () => {
        appelsOr += 1;
        return HttpResponse.json(PAGE_VIDE);
      }),
      http.get(CHEMIN_FINANCIER, () => {
        appelsFinancier += 1;
        return HttpResponse.json({});
      }),
    );
    const { container: magasinier } = rendre('magasinier');
    const { container: comptable } = rendre('comptable');

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(magasinier).toBeEmptyDOMElement();
    expect(comptable).toBeEmptyDOMElement();
    expect(appelsOr).toBe(0);
    expect(appelsFinancier).toBe(0);
  });

  it('un seul OR en retard (singulier ICU) : la ligne s’affiche, sans aucun montant ni requête financière', async () => {
    let appelsFinancier = 0;
    server.use(
      http.get(CHEMIN_OR, () =>
        HttpResponse.json({ ...PAGE_VIDE, donnees: [construireOrResume({ enRetard: true })] }),
      ),
      http.get(CHEMIN_FINANCIER, () => {
        appelsFinancier += 1;
        return HttpResponse.json({});
      }),
    );
    const { container } = rendre('direction');

    expect(
      await screen.findByText(
        i18n.t('tableauBord:bandeauPriorite.orEnRetard.libelle', { count: 1 }),
      ),
    ).toBeInTheDocument();
    expect(container).not.toHaveTextContent('CHF');
    expect(appelsFinancier).toBe(0);
  });

  it('plusieurs OR en retard (pluriel ICU) : compte exact et lien vers la liste des OR', async () => {
    server.use(
      http.get(CHEMIN_OR, () =>
        HttpResponse.json({
          ...PAGE_VIDE,
          donnees: [
            construireOrResume({ id: 'or-1', enRetard: true }),
            construireOrResume({ id: 'or-2', enRetard: true }),
            construireOrResume({ id: 'or-3', enRetard: false }),
          ],
        }),
      ),
    );
    rendre('direction');

    const libelle = i18n.t('tableauBord:bandeauPriorite.orEnRetard.libelle', { count: 2 });
    expect(await screen.findByText(libelle)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: libelle })).toHaveAttribute(
      'href',
      expect.stringContaining('/ordres-reparation'),
    );
  });
});
