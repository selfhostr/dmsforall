import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { FinancementResume } from '@dfa/shared';

import '@/i18n';

import { server } from '@/test/msw/server';
import { creerQueryClientTest } from '@/test/utils';

import { CarteFinancement } from './CarteFinancement';

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const FINANCEMENT_COURANT: FinancementResume = {
  id: 'financement-1',
  type: 'leasing',
  organisme: { id: 'client-organisme-1', nomAffiche: 'Multilease SA' },
  statutConfirmation: 'en_attente',
};

function rendre(ui: Parameters<typeof render>[0]) {
  const queryClient = creerQueryClientTest();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('CarteFinancement', () => {
  it('affiche un état vide avec une action « Proposer un financement » sans tentative existante', () => {
    rendre(
      <CarteFinancement
        dossierVenteId="dossier-1"
        financement={null}
        financements={[]}
        financementsTronques={false}
        statutDossierVente="engage"
        role="vendeur"
      />,
    );

    expect(screen.getByText('Aucune tentative de financement enregistrée.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Proposer un financement' })).toBeInTheDocument();
  });

  it('n’affiche pas l’action de proposition pour un dossier clos', () => {
    rendre(
      <CarteFinancement
        dossierVenteId="dossier-1"
        financement={null}
        financements={[]}
        financementsTronques={false}
        statutDossierVente="clos"
        role="vendeur"
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Proposer un financement' }),
    ).not.toBeInTheDocument();
  });

  it('affiche le financement courant, son organisme et son statut, plus l’historique', () => {
    rendre(
      <CarteFinancement
        dossierVenteId="dossier-1"
        financement={FINANCEMENT_COURANT}
        financements={[FINANCEMENT_COURANT]}
        financementsTronques={false}
        statutDossierVente="engage"
        role="vendeur"
      />,
    );

    // Le financement courant est affiché DEUX fois par construction (§9.1/§9.2 du design) : le
    // bloc « courant » en tête de carte, et sa propre entrée dans l'historique complet en
    // dessous — chaque texte y apparaît donc deux fois.
    expect(screen.getAllByText('Leasing')).toHaveLength(2);
    expect(screen.getAllByText('Multilease SA')).toHaveLength(2);
    expect(screen.getAllByText('En attente')).toHaveLength(2);
    expect(screen.getAllByText('Actuel')).toHaveLength(2);
  });

  it('affiche l’historique tronqué avec sa mention explicite', () => {
    rendre(
      <CarteFinancement
        dossierVenteId="dossier-1"
        financement={FINANCEMENT_COURANT}
        financements={[FINANCEMENT_COURANT]}
        financementsTronques
        statutDossierVente="engage"
        role="vendeur"
      />,
    );

    expect(screen.getByText('Historique limité aux 20 dernières tentatives')).toBeInTheDocument();
  });

  it('affiche l’erreur serveur dans le dialog de proposition, sans le fermer', async () => {
    const utilisateur = userEvent.setup();
    server.use(
      http.post('/api/v1/dossiers-vente/:id/financements', () =>
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

    rendre(
      <CarteFinancement
        dossierVenteId="dossier-1"
        financement={null}
        financements={[]}
        financementsTronques={false}
        statutDossierVente="engage"
        role="vendeur"
      />,
    );

    await utilisateur.click(screen.getByRole('button', { name: 'Proposer un financement' }));
    await utilisateur.click(await screen.findByRole('button', { name: 'Proposer' }));

    await waitFor(() => {
      expect(screen.getByText("Une erreur interne s'est produite. Réessayez.")).toBeInTheDocument();
    });
    // Le dialog reste ouvert — l'erreur est visible DANS le dialog (§4 du design), jamais après
    // fermeture.
    expect(screen.getByRole('button', { name: 'Proposer' })).toBeInTheDocument();
  });

  // Parcours « créer » complet (comptant, sans organisme requis) — même préoccupation que le test
  // de création de `CarteReprise.spec.tsx` : prouver le câblage jusqu'ici jamais exercé sur un
  // écran routé (`CarteFinancement` n'était monté nulle part avant le branchement dans
  // `EcranFicheDossierVente`).
  it('propose un financement comptant : POST avec le bon corps puis fermeture', async () => {
    const onMutationReussie = vi.fn();
    let corpsRecu: Record<string, unknown> | undefined;

    server.use(
      http.post('/api/v1/dossiers-vente/:id/financements', async ({ request }) => {
        corpsRecu = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          donnees: {
            id: 'financement-comptant-1',
            dossierVenteId: 'dossier-1',
            type: 'comptant',
            organisme: null,
            referenceContrat: null,
            statutConfirmation: 'confirme',
            confirmeLe: '2026-08-06T09:00:00.000Z',
            refuseLe: null,
            motifRefus: null,
            actionsDisponibles: [],
            version: 1,
            creeLe: '2026-08-06T09:00:00.000Z',
            modifieLe: '2026-08-06T09:00:00.000Z',
          },
          avertissements: [],
        });
      }),
    );

    const utilisateur = userEvent.setup();
    rendre(
      <CarteFinancement
        dossierVenteId="dossier-1"
        financement={null}
        financements={[]}
        financementsTronques={false}
        statutDossierVente="prospection"
        role="vendeur"
        onMutationReussie={onMutationReussie}
      />,
    );

    await utilisateur.click(screen.getByRole('button', { name: 'Proposer un financement' }));
    await utilisateur.click(await screen.findByRole('button', { name: 'Proposer' }));

    await waitFor(() => expect(corpsRecu).toBeDefined());
    expect(corpsRecu).toMatchObject({ type: 'comptant', organismeId: null });
    await waitFor(() => expect(onMutationReussie).toHaveBeenCalled());
    expect(
      screen.queryByRole('dialog', { name: 'Proposer un financement' }),
    ).not.toBeInTheDocument();
  });

  it('confirme un financement en attente : POST confirmer, callbacks appelés', async () => {
    const onMutationReussie = vi.fn();

    server.use(
      http.post('/api/v1/dossiers-vente/:id/financements/:financementId/confirmer', () =>
        HttpResponse.json({
          donnees: {
            ...FINANCEMENT_COURANT,
            statutConfirmation: 'confirme',
            confirmeLe: '2026-08-06T09:00:00.000Z',
          },
          avertissements: [],
        }),
      ),
    );

    const utilisateur = userEvent.setup();
    rendre(
      <CarteFinancement
        dossierVenteId="dossier-1"
        financement={FINANCEMENT_COURANT}
        financements={[FINANCEMENT_COURANT]}
        financementsTronques={false}
        statutDossierVente="engage"
        role="vendeur"
        onMutationReussie={onMutationReussie}
      />,
    );

    // « Confirmer » ouvre le dialog de confirmation, qui porte SON PROPRE bouton « Confirmer »
    // dans le pied de page — `within(dialog)` lève l'ambiguïté plutôt que de compter les index.
    await utilisateur.click(screen.getByRole('button', { name: 'Confirmer' }));
    const dialogue = await screen.findByRole('dialog', { name: 'Confirmer ce financement' });
    await utilisateur.click(within(dialogue).getByRole('button', { name: 'Confirmer' }));

    await waitFor(() => expect(onMutationReussie).toHaveBeenCalled());
  });

  it('refuse un financement en attente : le motif reste affiché après refus', async () => {
    server.use(
      http.post('/api/v1/dossiers-vente/:id/financements/:financementId/refuser', () =>
        HttpResponse.json({
          donnees: {
            ...FINANCEMENT_COURANT,
            statutConfirmation: 'refuse',
            refuseLe: '2026-08-06T09:00:00.000Z',
            motifRefus: 'Dossier de solvabilité incomplet',
          },
          avertissements: [],
        }),
      ),
    );

    const utilisateur = userEvent.setup();
    rendre(
      <CarteFinancement
        dossierVenteId="dossier-1"
        financement={FINANCEMENT_COURANT}
        financements={[FINANCEMENT_COURANT]}
        financementsTronques={false}
        statutDossierVente="engage"
        role="vendeur"
      />,
    );

    await utilisateur.click(screen.getByRole('button', { name: 'Refuser' }));
    // Le dialog porte SON PROPRE bouton « Confirmer » dans le pied de page, distinct du bouton
    // « Confirmer » resté visible dans la rangée d'actions sous le dialog — `within` lève
    // l'ambiguïté.
    const dialogue = await screen.findByRole('dialog', { name: 'Refuser ce financement' });
    await utilisateur.type(
      within(dialogue).getByLabelText('Motif du refus'),
      'Dossier de solvabilité incomplet',
    );
    await utilisateur.click(within(dialogue).getByRole('button', { name: 'Confirmer' }));

    await waitFor(() =>
      expect(
        screen.getByText('Motif du refus : Dossier de solvabilité incomplet'),
      ).toBeInTheDocument(),
    );
  });

  // RÈGLE DURE (masquage par rôle) : un rôle qui ne détient ni `ventes.financement.confirmer` ni
  // `ventes.financement.refuser` (`receptionnaire`, lecture seule sur ce sous-domaine) ne doit voir
  // AUCUN des deux boutons, pas un bouton grisé.
  it('un rôle en lecture seule (receptionnaire) ne voit aucune action sur un financement en attente', () => {
    rendre(
      <CarteFinancement
        dossierVenteId="dossier-1"
        financement={FINANCEMENT_COURANT}
        financements={[FINANCEMENT_COURANT]}
        financementsTronques={false}
        statutDossierVente="engage"
        role="receptionnaire"
      />,
    );

    expect(screen.queryByRole('button', { name: 'Confirmer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refuser' })).not.toBeInTheDocument();
  });
});
