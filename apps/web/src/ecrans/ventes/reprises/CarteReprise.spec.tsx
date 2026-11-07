import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { ReponseReprise, VehiculeResume } from '@dfa/shared';

import '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { CarteReprise } from './CarteReprise';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const PLAQUE_VEHICULE_REPRIS = '987654';

const VEHICULE_REPRIS: VehiculeResume = {
  id: '22222222-2222-4222-8222-222222222222',
  plaque: PLAQUE_VEHICULE_REPRIS,
  canton: 'GE',
  designation: 'Audi A4 2.0 TDI',
  vin: 'WAUZZZ8K9BA123456',
  premiereMiseEnCirculationLe: '2019-06-01',
  identificationIncomplete: false,
  emplacementLibre: null,
};

const REPRISE: ReponseReprise = {
  id: 'reprise-1',
  dossierVenteId: 'dossier-1',
  vehiculeRepris: {
    id: 'vehicule-1',
    plaque: '123456',
    canton: 'VD',
    designation: 'VW Touran 2.0 TDI',
    vin: 'WVWZZZ1KZAP123456',
    premiereMiseEnCirculationLe: '2018-03-01',
    identificationIncomplete: false,
    emplacementLibre: null,
  },
  statut: 'negociee',
  valeurEstimeeCentimes: 800_000,
  valeurNegocieeCentimes: 850_000,
  ecartRepriseVehiculeCentimes: 50_000,
  detteFinancementResiduelleCentimes: null,
  detteFinancementOrganismeId: null,
  detteFinancementOrganismeNom: null,
  estimeeLe: '2026-01-01T08:00:00.000Z',
  negocieeLe: '2026-01-02T08:00:00.000Z',
  confirmeeLe: null,
  refuseeLe: null,
  motifRefus: null,
  actionsDisponibles: ['negocier', 'refuser'],
  version: 1,
  creeLe: '2026-01-01T08:00:00.000Z',
  modifieLe: '2026-01-02T08:00:00.000Z',
  modifiePar: null,
};

function rendre(ui: ReactElement) {
  const queryClient = creerQueryClientTest();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CarteReprise', () => {
  it('affiche un état vide avec une action « Ajouter une reprise » quand le dossier n’en a pas', () => {
    rendre(<CarteReprise dossierVenteId="dossier-1" possedeReprise={false} role="vendeur" />);

    expect(screen.getByText('Pas de reprise sur cette vente')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ajouter une reprise' })).toBeInTheDocument();
  });

  it('n’affiche pas l’action d’ajout pour un rôle sans droit d’écriture', () => {
    rendre(
      <CarteReprise dossierVenteId="dossier-1" possedeReprise={false} role="receptionnaire" />,
    );

    expect(screen.getByText('Pas de reprise sur cette vente')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajouter une reprise' })).not.toBeInTheDocument();
  });

  it('affiche les deux valeurs, l’écart et le statut quand la reprise existe', async () => {
    server.use(http.get('/api/v1/dossiers-vente/:id/reprise', () => HttpResponse.json(REPRISE)));

    rendre(<CarteReprise dossierVenteId="dossier-1" possedeReprise role="vendeur" />);

    await waitFor(() => {
      expect(screen.getByText("8'500.00")).toBeInTheDocument();
    });
    expect(screen.getByText('Négociée')).toBeInTheDocument();
    expect(screen.getByText('VW Touran 2.0 TDI')).toBeInTheDocument();

    // Valeur estimée / écart masqués par défaut (constat testeur, même doctrine que
    // EcranFicheVehiculeStock) — la valeur négociée reste TOUJOURS visible (c'est celle annoncée
    // au client), mais l'estimation interne et l'écart n'apparaissent qu'après révélation
    // explicite.
    expect(screen.queryByText("8'000.00")).not.toBeInTheDocument();
    expect(screen.queryByText('+500.00')).not.toBeInTheDocument();
    const utilisateur = userEvent.setup();
    await utilisateur.click(screen.getByRole('button', { name: 'Voir Valeur estimée' }));
    expect(await screen.findByText("8'000.00")).toBeInTheDocument();
    expect(screen.getByText('+500.00')).toBeInTheDocument();
  });

  it('affiche une erreur actionnable (retry) si la reprise ne peut pas être chargée', async () => {
    server.use(
      http.get('/api/v1/dossiers-vente/:id/reprise', () =>
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

    rendre(<CarteReprise dossierVenteId="dossier-1" possedeReprise role="vendeur" />);

    await waitFor(() => {
      expect(screen.getByText("Impossible d'afficher cette reprise")).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  // Parcours « créer » (§8.1 du design) — vérifie que le formulaire complet (recherche véhicule,
  // valeur estimée) produit bien le corps attendu par `POST .../reprise` et prévient l'intégrateur
  // (`onMutationReussie`) : c'est CE câblage, jusqu'ici jamais exercé nulle part (`CarteReprise`
  // n'était monté sur aucun écran routé), que l'audit de branchement a signalé comme manquant.
  it('crée une reprise depuis l’état vide : recherche véhicule, valeur estimée, POST puis fermeture', async () => {
    const onMutationReussie = vi.fn();
    let corpsRecu: Record<string, unknown> | undefined;

    server.use(
      http.get('/api/v1/vehicules', () =>
        HttpResponse.json({ donnees: [VEHICULE_REPRIS], curseurSuivant: null, limite: 50 }),
      ),
      http.post('/api/v1/dossiers-vente/:id/reprise', async ({ request }) => {
        corpsRecu = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          donnees: { ...REPRISE, statut: 'estimee', valeurNegocieeCentimes: null },
          avertissements: [],
        });
      }),
    );

    const utilisateur = userEvent.setup();
    rendre(
      <CarteReprise
        dossierVenteId="dossier-1"
        possedeReprise={false}
        role="vendeur"
        onMutationReussie={onMutationReussie}
      />,
    );

    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter une reprise' }));
    await utilisateur.type(screen.getByLabelText(/Véhicule repris/), PLAQUE_VEHICULE_REPRIS);
    await utilisateur.click(await screen.findByRole('radio'));
    await utilisateur.type(screen.getByLabelText(/Valeur estimée/), '8000');
    await utilisateur.click(screen.getByRole('button', { name: 'Ajouter la reprise' }));

    await waitFor(() => expect(corpsRecu).toBeDefined());
    expect(corpsRecu).toMatchObject({
      vehiculeReprisId: VEHICULE_REPRIS.id,
      valeurEstimeeCentimes: 800_000,
    });
    await waitFor(() => expect(onMutationReussie).toHaveBeenCalled());
    expect(screen.queryByRole('dialog', { name: 'Ajouter une reprise' })).not.toBeInTheDocument();
  });

  // Parcours complet « négocier » puis « confirmer » (§8.4 du design, correction exceptionnelle
  // réservée à `direction`) — les mutations réécrivent directement le cache de `useReprise`
  // (`useActionReprise`, voir hooks/ventes/reprises/useTransitionsReprise.ts), donc chaque étape se
  // reflète dans CE MÊME rendu, sans remontage.
  it('cycle complet : négocier une reprise en cours d’estimation puis la confirmer (direction)', async () => {
    const REPRISE_ESTIMEE: ReponseReprise = {
      ...REPRISE,
      statut: 'estimee',
      valeurNegocieeCentimes: null,
      ecartRepriseVehiculeCentimes: null,
      negocieeLe: null,
      actionsDisponibles: ['negocier', 'refuser'],
    };

    server.use(
      http.get('/api/v1/dossiers-vente/:id/reprise', () => HttpResponse.json(REPRISE_ESTIMEE)),
      http.post('/api/v1/dossiers-vente/:id/reprise/negocier', async ({ request }) => {
        const corps = (await request.json()) as { valeurNegocieeCentimes: number };
        return HttpResponse.json({
          donnees: {
            ...REPRISE_ESTIMEE,
            statut: 'negociee',
            valeurNegocieeCentimes: corps.valeurNegocieeCentimes,
            ecartRepriseVehiculeCentimes:
              corps.valeurNegocieeCentimes - REPRISE_ESTIMEE.valeurEstimeeCentimes,
            actionsDisponibles: ['negocier', 'refuser', 'confirmer'],
          },
          avertissements: [],
        });
      }),
      http.post('/api/v1/dossiers-vente/:id/reprise/confirmer', () =>
        HttpResponse.json({
          donnees: {
            ...REPRISE_ESTIMEE,
            statut: 'confirmee',
            valeurNegocieeCentimes: 900_000,
            ecartRepriseVehiculeCentimes: 100_000,
            confirmeeLe: '2026-08-06T09:00:00.000Z',
            actionsDisponibles: [],
          },
          avertissements: [],
        }),
      ),
    );

    const utilisateur = userEvent.setup();
    rendre(<CarteReprise dossierVenteId="dossier-1" possedeReprise role="direction" />);

    await utilisateur.click(await screen.findByRole('button', { name: 'Négocier' }));
    await utilisateur.type(screen.getByLabelText(/Nouvelle valeur négociée/), '9000');
    await utilisateur.click(screen.getByRole('button', { name: 'Confirmer' }));

    await waitFor(() => expect(screen.getByText('Négociée')).toBeInTheDocument());
    expect(screen.getByText("9'000.00")).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: 'Actions de correction' }));
    await utilisateur.click(screen.getByRole('menuitem', { name: 'Confirmer' }));
    await utilisateur.type(screen.getByLabelText(/^Motif\s*\*$/), 'Signature du bon de commande');
    await utilisateur.click(screen.getByRole('button', { name: 'Confirmer' }));

    await waitFor(() => expect(screen.getByText('Confirmée')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Négocier' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions de correction' })).not.toBeInTheDocument();
  });

  it('refuse une reprise en cours de négociation (vendeur) : le motif reste affiché', async () => {
    server.use(
      http.get('/api/v1/dossiers-vente/:id/reprise', () => HttpResponse.json(REPRISE)),
      http.post('/api/v1/dossiers-vente/:id/reprise/refuser', () =>
        HttpResponse.json({
          donnees: {
            ...REPRISE,
            statut: 'refusee',
            motifRefus: 'Le client garde son véhicule',
            refuseeLe: '2026-08-06T09:00:00.000Z',
            actionsDisponibles: [],
          },
          avertissements: [],
        }),
      ),
    );

    const utilisateur = userEvent.setup();
    rendre(<CarteReprise dossierVenteId="dossier-1" possedeReprise role="vendeur" />);

    await utilisateur.click(await screen.findByRole('button', { name: 'Refuser' }));
    await utilisateur.type(
      screen.getByLabelText(/^Motif du refus\s*\*$/),
      'Le client garde son véhicule',
    );
    await utilisateur.click(screen.getByRole('button', { name: 'Confirmer' }));

    await waitFor(() => expect(screen.getByText('Refusée')).toBeInTheDocument());
    expect(screen.getByText('Motif du refus : Le client garde son véhicule')).toBeInTheDocument();
  });

  // RÈGLE DURE (masquage par rôle) : un rôle sans droit d'écriture/refus ne doit voir AUCUN des
  // boutons d'action de la reprise — pas un bouton grisé, rien.
  it('un rôle en lecture seule (receptionnaire) ne voit aucune action sur une reprise négociable', async () => {
    server.use(http.get('/api/v1/dossiers-vente/:id/reprise', () => HttpResponse.json(REPRISE)));

    rendre(<CarteReprise dossierVenteId="dossier-1" possedeReprise role="receptionnaire" />);

    await waitFor(() => expect(screen.getByText('Négociée')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Négocier' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refuser' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Actions de correction' })).not.toBeInTheDocument();
  });
});
