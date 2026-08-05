import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { LigneSuiviVente, PageCurseur } from '@dfa/shared';

import '@/i18n';

import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { EcranSuiviVentes } from './EcranSuiviVentes';

const LIGNE_NOMINALE: LigneSuiviVente = {
  dossierVenteId: 'dossier-1',
  siteId: 'site-1',
  dossierStatut: 'livre',
  clientAcheteur: { id: 'client-1', nomAffiche: 'Jean Dupont' },
  vehicule: { id: 'vehicule-1', designation: 'Toyota Yaris', vin: 'VIN000000001' },
  financement: {
    id: 'financement-1',
    type: 'leasing',
    statutConfirmation: 'confirme',
    organisme: { id: 'organisme-1', nomAffiche: 'Leasing SA' },
    confirmeLe: '2026-08-04T15:43:25.877Z',
    dureeMois: 48,
    echeanceLe: '2030-08-04',
  },
  garantie: null,
  prochaineEcheanceLe: '2030-08-04',
};

function page(donnees: LigneSuiviVente[]): PageCurseur<LigneSuiviVente> {
  return { donnees, curseurSuivant: null, limite: 50 };
}

function rendre() {
  server.use(http.get('/api/v1/auth/moi', () => HttpResponse.json(SESSION_TEST)));
  const queryClient = creerQueryClientTest();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/ventes/suivi']}>
        <Routes>
          <Route path="/ventes/suivi" element={<EcranSuiviVentes />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EcranSuiviVentes', () => {
  it('affichage nominal : client, véhicule et échéance de financement visibles', async () => {
    server.use(http.get('/api/v1/ventes/suivi', () => HttpResponse.json(page([LIGNE_NOMINALE]))));

    rendre();

    expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();
    expect(screen.getByText(/Toyota Yaris/)).toBeInTheDocument();
    expect(screen.getByText(/VIN000000001/)).toBeInTheDocument();
    expect(screen.getByText('Leasing SA')).toBeInTheDocument();
  });

  it('liste vide : formulée comme une bonne nouvelle, jamais comme un échec', async () => {
    server.use(http.get('/api/v1/ventes/suivi', () => HttpResponse.json(page([]))));

    rendre();

    expect(await screen.findByText('Aucune échéance à venir')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Bonne nouvelle : aucun dossier n'arrive à échéance sur la période sélectionnée.",
      ),
    ).toBeInTheDocument();
  });

  it('état erreur : message actionnable avec retry, ET les onglets restent visibles (choix d’horizon toujours possible)', async () => {
    server.use(
      http.get('/api/v1/ventes/suivi', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur interne',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: 'req-1',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    rendre();

    expect(
      await screen.findByText("Impossible d'afficher le suivi des échéances"),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
    // DÉFAUT AUDIT corrigé : une erreur réseau ne doit jamais faire disparaître la barre
    // d'onglets — sinon plus aucun moyen de revenir à l'onglet précédent.
    expect(screen.getByRole('tab', { name: '30 prochains jours' })).toBeInTheDocument();
  });

  // DÉFAUT AUDIT — les onglets s'évaporaient : les retours anticipés chargement/erreur vivaient
  // AVANT le rendu des onglets, donc chaque changement d'horizon (nouvelle clé de requête,
  // `isPending` repasse à vrai) faisait disparaître puis réapparaître la barre entière. Preuve
  // directe : la barre d'onglets est présente PENDANT le chargement, pas seulement avant/après.
  it('les onglets restent visibles pendant le chargement (jamais d’évaporation au changement d’horizon)', async () => {
    server.use(
      http.get('/api/v1/ventes/suivi', async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return HttpResponse.json(page([LIGNE_NOMINALE]));
      }),
    );

    rendre();

    // Encore en vol : les onglets sont déjà là, la table pas encore.
    expect(screen.getByRole('tab', { name: '30 prochains jours' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '90 prochains jours' })).toBeInTheDocument();
    expect(screen.queryByText('Jean Dupont')).not.toBeInTheDocument();

    expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();
    // Toujours là après résolution — pas de clignotement.
    expect(screen.getByRole('tab', { name: '30 prochains jours' })).toBeInTheDocument();
  });

  it('changer d’onglet ne fait pas disparaître la barre, même pendant le rechargement induit', async () => {
    server.use(http.get('/api/v1/ventes/suivi', () => HttpResponse.json(page([LIGNE_NOMINALE]))));
    const utilisateur = userEvent.setup();
    rendre();

    expect(await screen.findByText('Jean Dupont')).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('tab', { name: '90 prochains jours' }));

    // La barre reste montée pendant que la nouvelle page (nouvelle clé de requête) se charge.
    expect(screen.getByRole('tab', { name: '30 prochains jours' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '90 prochains jours' })).toBeInTheDocument();
  });

  it("échéance de financement non confirmée : jamais estimée, aucune date inventée sur l'écran complet", async () => {
    const ligne: LigneSuiviVente = {
      ...LIGNE_NOMINALE,
      dossierVenteId: 'dossier-2',
      clientAcheteur: { id: 'client-2', nomAffiche: 'Marie Rossier' },
      financement: {
        id: 'financement-2',
        type: 'credit',
        statutConfirmation: 'en_attente',
        organisme: { id: 'organisme-2', nomAffiche: 'Banque SA' },
        confirmeLe: null,
        dureeMois: null,
        echeanceLe: null,
      },
      garantie: null,
      prochaineEcheanceLe: null,
    };
    server.use(http.get('/api/v1/ventes/suivi', () => HttpResponse.json(page([ligne]))));

    rendre();

    expect(await screen.findByText('Marie Rossier')).toBeInTheDocument();
    expect(
      screen.getByText('En attente de confirmation — échéance non estimée'),
    ).toBeInTheDocument();
    expect(screen.getByText('Aucune échéance connue')).toBeInTheDocument();
    expect(screen.queryByText(/\d{2}\.\d{2}\.\d{4}/)).not.toBeInTheDocument();
  });

  it('rôle sans droit financier (RF-116) : le financement masqué par le serveur reste visible sans montant, jamais une colonne vide ni une erreur', async () => {
    // `dureeMois`/`echeanceLe` OMISES par le serveur (voir `service-suivi-vente.ts`) — reproduit
    // ici la forme JSON exacte qu'un rôle sans `roleVoitLesMontants` reçoit réellement, pas une
    // approximation côté test.
    const ligneAvecFinancementMasque: LigneSuiviVente = {
      ...LIGNE_NOMINALE,
      dossierVenteId: 'dossier-3',
      clientAcheteur: { id: 'client-3', nomAffiche: 'Paul Morand' },
      financement: {
        id: 'financement-3',
        type: 'leasing',
        statutConfirmation: 'confirme',
        organisme: { id: 'organisme-3', nomAffiche: 'Leasing Masqué SA' },
        confirmeLe: '2026-08-04T15:43:25.877Z',
        // dureeMois / echeanceLe absentes — masquage RF-116.
      },
      prochaineEcheanceLe: null,
    };
    server.use(
      http.get('/api/v1/ventes/suivi', () => HttpResponse.json(page([ligneAvecFinancementMasque]))),
    );

    rendre();

    expect(await screen.findByText('Paul Morand')).toBeInTheDocument();
    expect(screen.getByText('Leasing Masqué SA')).toBeInTheDocument();
    expect(screen.getByText('Non communiqué')).toBeInTheDocument();
    expect(screen.queryByText(/\d{2}\.\d{2}\.\d{4}/)).not.toBeInTheDocument();
  });
});
