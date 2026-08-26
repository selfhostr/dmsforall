import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  ClientResume,
  OrdreReparationResume,
  ReponseFinancierTableauBord,
  VehiculeResume,
} from '@dfa/shared';

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

const FINANCIER_VIDE: ReponseFinancierTableauBord = {
  periode: { du: '2026-08-01', au: '2026-08-31' },
  siteId: null,
  chiffreAffaires: {
    totalHtCentimes: 0,
    totalTvaCentimes: 0,
    totalTtcCentimes: 0,
    nombreDocuments: 0,
  },
  encaissementsCentimes: 0,
  encoursClientsCentimes: 0,
  marges: {
    vehicules: { margeCentimes: 0, nombreVehiculesFactures: 0 },
    pieces: { disponible: false, raisonCle: 'piecesCoutNonFiable' },
    mainOeuvre: { disponible: false, raisonCle: 'mainOeuvreCoutAbsent' },
  },
  stockPieces: { totalCentimes: 0, articlesValeurInconnueNombre: 0 },
};

function financierAvecEncours(encoursClientsCentimes: number): ReponseFinancierTableauBord {
  return { ...FINANCIER_VIDE, encoursClientsCentimes };
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

  it('deux compteurs à zéro : ne se rend pas du tout (jamais un bandeau « tout va bien »)', async () => {
    server.use(
      http.get(CHEMIN_OR, () => HttpResponse.json(PAGE_VIDE)),
      http.get(CHEMIN_FINANCIER, () => HttpResponse.json(FINANCIER_VIDE)),
    );
    const { container } = rendre('direction');

    // Laisse les deux requêtes réutilisées se résoudre avant d'affirmer l'absence.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container).toBeEmptyDOMElement();
  });

  it('rôle sans aucun des deux droits (magasinier) : absent, et ne déclenche AUCUNE requête', async () => {
    let appelsOr = 0;
    let appelsFinancier = 0;
    server.use(
      http.get(CHEMIN_OR, () => {
        appelsOr += 1;
        return HttpResponse.json(PAGE_VIDE);
      }),
      http.get(CHEMIN_FINANCIER, () => {
        appelsFinancier += 1;
        return HttpResponse.json(FINANCIER_VIDE);
      }),
    );
    const { container } = rendre('magasinier');

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container).toBeEmptyDOMElement();
    expect(appelsOr).toBe(0);
    expect(appelsFinancier).toBe(0);
  });

  it('un seul OR en retard (singulier ICU) : la ligne OR seule s’affiche, factures absentes', async () => {
    server.use(
      http.get(CHEMIN_OR, () =>
        HttpResponse.json({ ...PAGE_VIDE, donnees: [construireOrResume({ enRetard: true })] }),
      ),
      http.get(CHEMIN_FINANCIER, () => HttpResponse.json(FINANCIER_VIDE)),
    );
    rendre('direction');

    expect(
      await screen.findByText(
        i18n.t('tableauBord:bandeauPriorite.orEnRetard.libelle', { count: 1 }),
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/factures impayées/)).not.toBeInTheDocument();
  });

  it('plusieurs OR en retard (pluriel ICU) et des factures impayées : les deux lignes s’affichent', async () => {
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
      http.get(CHEMIN_FINANCIER, () => HttpResponse.json(financierAvecEncours(45600))),
    );
    rendre('direction');

    expect(
      await screen.findByText(
        i18n.t('tableauBord:bandeauPriorite.orEnRetard.libelle', { count: 2 }),
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        i18n.t('tableauBord:bandeauPriorite.facturesImpayees.libelle', {
          montant: 'CHF 456.00',
        }),
      ),
    ).toBeInTheDocument();

    const lienOr = screen.getByRole('link', {
      name: i18n.t('tableauBord:bandeauPriorite.orEnRetard.libelle', { count: 2 }),
    });
    expect(lienOr).toHaveAttribute('href', expect.stringContaining('/ordres-reparation'));

    const lienFacture = screen.getByRole('link', {
      name: i18n.t('tableauBord:bandeauPriorite.facturesImpayees.libelle', {
        montant: 'CHF 456.00',
      }),
    });
    expect(lienFacture).toHaveAttribute('href', expect.stringContaining('/factures'));
  });

  it('comptable : factures impayées seules (aucun droit sur les OR, aucune requête vers /ordres-reparation)', async () => {
    let appelsOr = 0;
    server.use(
      http.get(CHEMIN_OR, () => {
        appelsOr += 1;
        return HttpResponse.json(PAGE_VIDE);
      }),
      http.get(CHEMIN_FINANCIER, () => HttpResponse.json(financierAvecEncours(45600))),
    );
    rendre('comptable');

    expect(
      await screen.findByText(
        i18n.t('tableauBord:bandeauPriorite.facturesImpayees.libelle', { montant: 'CHF 456.00' }),
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(i18n.t('tableauBord:bandeauPriorite.orEnRetard.libelle', { count: 1 })),
    ).not.toBeInTheDocument();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(appelsOr).toBe(0);
  });
});
