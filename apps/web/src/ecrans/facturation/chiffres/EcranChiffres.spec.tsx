import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import '@/i18n';
import i18n from '@/i18n';

import { server } from '@/test/msw/server';
import { creerSessionTest } from '@/test/session';
import { creerQueryClientTest } from '@/test/utils';

import { EcranChiffres } from './EcranChiffres';

const CHEMIN_FINANCIER = '/api/v1/tableau-bord/financier';
const CHEMIN_PAIEMENTS = '/api/v1/paiements';
const CHEMIN_DOCUMENTS = '/api/v1/documents-vente';
const CHEMIN_OR = '/api/v1/ordres-reparation';
const PAGE_VIDE = { donnees: [], curseurSuivant: null, limite: 200 };

function connecter(role: Parameters<typeof creerSessionTest>[0]) {
  server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(creerSessionTest(role))));
}

function ca(ht: number, tva: number, ttc: number, n: number) {
  return {
    periode: { du: '2026-11-01', au: '2026-11-30' },
    siteId: null,
    chiffreAffaires: {
      totalHtCentimes: ht,
      totalTvaCentimes: tva,
      totalTtcCentimes: ttc,
      nombreDocuments: n,
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
}

function rendre() {
  return render(
    <QueryClientProvider client={creerQueryClientTest()}>
      <MemoryRouter initialEntries={['/factures/chiffres']}>
        <Routes>
          <Route path="/factures/chiffres" element={<EcranChiffres />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubsNominaux() {
  server.use(
    http.get(CHEMIN_FINANCIER, ({ request }) => {
      const du = new URL(request.url).searchParams.get('du') ?? '';
      // Trois fenêtres distinctes, reconnues par leur borne `du` : mois courant (jour 01), année (01-01).
      if (du.endsWith('-01-01')) return HttpResponse.json(ca(12000000, 972000, 12972000, 120));
      const mois = Number(du.slice(5, 7));
      const courant = new Date().getMonth() + 1;
      return HttpResponse.json(
        mois === courant ? ca(1000000, 81000, 1081000, 10) : ca(800000, 64800, 864800, 8),
      );
    }),
    http.get(CHEMIN_PAIEMENTS, () =>
      HttpResponse.json({
        ...PAGE_VIDE,
        donnees: [
          { moyen: 'carte', montantCentimes: 100050 },
          { moyen: 'especes', montantCentimes: 25000 },
          { moyen: 'carte', montantCentimes: 4950 },
        ],
      }),
    ),
    http.get(CHEMIN_DOCUMENTS, () =>
      HttpResponse.json({
        ...PAGE_VIDE,
        donnees: [
          {
            id: 'f1',
            typeDocument: 'facture',
            statut: 'emis',
            soldeCentimes: 123450,
            enRetard: true,
            figees: { clientDesignation: 'A' },
          },
          {
            id: 'f2',
            typeDocument: 'facture',
            statut: 'emis',
            soldeCentimes: 50000,
            enRetard: false,
            figees: { clientDesignation: 'B' },
          },
        ],
      }),
    ),
    http.get(CHEMIN_OR, () =>
      HttpResponse.json({
        ...PAGE_VIDE,
        donnees: [
          { id: 'or1', totalTtcCentimes: 80000 },
          { id: 'or2', totalTtcCentimes: 45050 },
        ],
      }),
    ),
  );
}

describe('EcranChiffres', () => {
  it("direction : chiffres exacts au format CHF 1'234.50, par période et par moyen", async () => {
    connecter('direction');
    stubsNominaux();
    rendre();

    // CA : trois lignes, valeurs exactes.
    expect(await screen.findByText("CHF 10'810.00")).toBeInTheDocument(); // mois courant TTC
    expect(screen.getByText("CHF 10'000.00")).toBeInTheDocument(); // mois courant HT
    expect(screen.getByText('CHF 810.00')).toBeInTheDocument(); // TVA mois courant
    expect(screen.getByText("CHF 8'648.00")).toBeInTheDocument(); // mois précédent TTC
    expect(screen.getByText("CHF 129'720.00")).toBeInTheDocument(); // année TTC

    // Encaissements par moyen : carte 1050.00 + 49.50 = 1'050.00 ; espèces 250.00 ; total 1'300.00.
    expect(await screen.findByText("CHF 1'050.00")).toBeInTheDocument();
    expect(screen.getByText('CHF 250.00')).toBeInTheDocument();
    expect(screen.getByText("CHF 1'300.00")).toBeInTheDocument();

    // Factures ouvertes : 2 (1'734.50), dont 1 en retard (1'234.50).
    expect(await screen.findByText("CHF 1'734.50")).toBeInTheDocument();
    expect(screen.getByText("CHF 1'234.50")).toBeInTheDocument();

    // OR à facturer : 2, estimé 1'250.50.
    expect(await screen.findByText("CHF 1'250.50")).toBeInTheDocument();

    // Les dates des périodes s'écrivent jj.mm.aaaa.
    expect(screen.getAllByText(/^\d{2}\.\d{2}\.\d{4} – \d{2}\.\d{2}\.\d{4}$/)).toHaveLength(3);
  });

  it('comptable : accès autorisé', async () => {
    connecter('comptable');
    stubsNominaux();
    rendre();
    expect(await screen.findByText("CHF 10'810.00")).toBeInTheDocument();
  });

  it('chef d’atelier : accès refusé, aucune requête de chiffres', async () => {
    connecter('chef_atelier');
    let appels = 0;
    server.use(
      http.get(CHEMIN_FINANCIER, () => {
        appels += 1;
        return HttpResponse.json({});
      }),
      http.get(CHEMIN_PAIEMENTS, () => {
        appels += 1;
        return HttpResponse.json(PAGE_VIDE);
      }),
    );
    rendre();
    expect(
      await screen.findByText(i18n.t('facturation:chiffres.refuse.titre')),
    ).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(appels).toBe(0);
  });

  it('chargement : squelettes pendant que les données arrivent', async () => {
    connecter('direction');
    server.use(
      http.get(CHEMIN_FINANCIER, () => new Promise(() => undefined)),
      http.get(CHEMIN_PAIEMENTS, () => new Promise(() => undefined)),
      http.get(CHEMIN_DOCUMENTS, () => new Promise(() => undefined)),
      http.get(CHEMIN_OR, () => new Promise(() => undefined)),
    );
    rendre();
    await waitFor(() => expect(screen.getAllByRole('status').length).toBeGreaterThanOrEqual(4));
  });

  it('vide : messages explicites par section, aucun montant inventé', async () => {
    connecter('direction');
    server.use(
      http.get(CHEMIN_FINANCIER, () => HttpResponse.json(ca(0, 0, 0, 0))),
      http.get(CHEMIN_PAIEMENTS, () => HttpResponse.json(PAGE_VIDE)),
      http.get(CHEMIN_DOCUMENTS, () => HttpResponse.json(PAGE_VIDE)),
      http.get(CHEMIN_OR, () => HttpResponse.json(PAGE_VIDE)),
    );
    const { container } = rendre();
    for (const cle of ['chiffreAffaires', 'encaissements', 'facturesOuvertes', 'travauxTermines']) {
      expect(
        await screen.findByText(i18n.t(`facturation:chiffres.${cle}.vide.titre`)),
      ).toBeInTheDocument();
    }
    expect(container).not.toHaveTextContent('CHF');
  });

  it('erreur : une section en panne affiche un message et réessaie, les autres restent', async () => {
    connecter('direction');
    stubsNominaux();
    let appels = 0;
    server.use(
      http.get(CHEMIN_OR, () => {
        appels += 1;
        if (appels === 1) {
          return HttpResponse.json(
            { type: 'x', title: 'Erreur interne', status: 500, code: 'ERREUR_INTERNE' },
            { status: 500, headers: { 'content-type': 'application/problem+json' } },
          );
        }
        return HttpResponse.json({
          ...PAGE_VIDE,
          donnees: [{ id: 'or1', totalTtcCentimes: 1000 }],
        });
      }),
    );
    rendre();

    const alerte = await screen.findByRole('alert');
    expect(within(alerte).getByText(i18n.t('facturation:chiffres.erreur'))).toBeInTheDocument();
    expect(await screen.findByText("CHF 10'810.00")).toBeInTheDocument();

    await userEvent
      .setup()
      .click(within(alerte).getByRole('button', { name: i18n.t('commun:actions.reessayer') }));
    expect(await screen.findByText('CHF 10.00')).toBeInTheDocument();
  });
});

vi.setConfig({ testTimeout: 15000 });
