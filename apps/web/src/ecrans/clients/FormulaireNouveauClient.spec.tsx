import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import type { ReponseClient, ReponseDoublonsClients } from '@dfa/shared';

import { server } from '@/test/msw/server';
import { renduAvecRoutes } from '@/test/utils';

import { FormulaireNouveauClient } from './FormulaireNouveauClient';

const CLIENT_CREE: ReponseClient = {
  id: 'cl-42',
  numeroClient: 'CL-000042',
  type: 'particulier',
  statut: 'actif',
  civilite: null,
  nom: 'Rossi',
  prenom: 'Isabelle',
  raisonSociale: null,
  nomAffiche: 'Isabelle Rossi',
  ide: null,
  langueCorrespondance: 'fr',
  email: null,
  telephone: null,
  telephoneE164: null,
  poObligatoire: false,
  groupeId: null,
  fusionneVersClientId: null,
  referenceExterne: null,
  dernierPassageLe: null,
  creeLe: '2026-07-28T08:00:00.000Z',
  modifieLe: '2026-07-28T08:00:00.000Z',
  notesAlerte: [],
};

async function remplirIdentiteMinimale(utilisateur: ReturnType<typeof userEvent.setup>) {
  await utilisateur.type(screen.getByLabelText('Nom'), 'Rossi');
  await utilisateur.type(screen.getByLabelText('Rue et numéro'), 'Rue Neuve 5');
  await utilisateur.type(screen.getByLabelText('NPA'), '1000');
  await utilisateur.type(screen.getByLabelText('Localité'), 'Lausanne');
}

function rendreFormulaire(onCree = vi.fn(), routeInitiale = '/') {
  const resultat = renduAvecRoutes(
    [
      { path: '/', element: <FormulaireNouveauClient onCree={onCree} /> },
      { path: '/clients/:id', element: <div>PAGE_FICHE_CLIENT</div> },
    ],
    { routeInitiale },
  );
  return { ...resultat, onCree };
}

describe('FormulaireNouveauClient', () => {
  it("crée directement quand l'aperçu de doublons ne remonte aucun candidat", async () => {
    server.use(
      http.get('/api/v1/doublons-clients', () =>
        HttpResponse.json({ candidats: [] } satisfies ReponseDoublonsClients),
      ),
      http.post('/api/v1/clients', () =>
        HttpResponse.json({ donnees: CLIENT_CREE, avertissements: [] }),
      ),
    );
    const utilisateur = userEvent.setup();
    const { onCree } = rendreFormulaire();

    await remplirIdentiteMinimale(utilisateur);
    await utilisateur.click(screen.getByRole('button', { name: 'Créer le client' }));

    await waitFor(() => expect(onCree).toHaveBeenCalledWith('cl-42'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ouvre la confirmation en deux temps (AvertissementConfirmable, pas un refus) quand un doublon probable existe, puis crée quand même', async () => {
    const REPONSE_DOUBLONS: ReponseDoublonsClients = {
      candidats: [
        {
          clientId: 'cl-1',
          numeroClient: 'CL-000001',
          nom: 'Isabelle Rossi',
          npa: '1000',
          critere: 'nom_npa',
          score: 0.92,
        },
      ],
    };
    server.use(
      http.get('/api/v1/doublons-clients', () => HttpResponse.json(REPONSE_DOUBLONS)),
      http.post('/api/v1/clients', () =>
        HttpResponse.json({ donnees: CLIENT_CREE, avertissements: [] }),
      ),
    );
    const utilisateur = userEvent.setup();
    const { onCree } = rendreFormulaire();

    await remplirIdentiteMinimale(utilisateur);

    // Aperçu live non bloquant : le candidat apparaît sous les champs avant toute soumission.
    // Timeout généreux (défaut 1000 ms sinon) : le composant applique un debounce de 400 ms avant
    // d'interroger /api/v1/doublons-clients (MSW), et l'ensemble peut dépasser la fenêtre par
    // défaut quand la suite tourne à pleine charge (CPU partagé entre workers) — sans que le
    // comportement réel change. Un timeout trop court ici fait échouer le test par lenteur
    // d'exécution, pas par régression du composant.
    expect(await screen.findByText(/Isabelle Rossi/, {}, { timeout: 3000 })).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: 'Créer le client' }));

    const dialogue = await screen.findByRole('dialog');
    expect(within(dialogue).getByText('Doublons détectés')).toBeInTheDocument();
    expect(onCree).not.toHaveBeenCalled();

    await utilisateur.click(within(dialogue).getByRole('button', { name: 'Créer quand même' }));

    await waitFor(() => expect(onCree).toHaveBeenCalledWith('cl-42'));
  });

  describe('propagation du site (?site=) au lien « Voir » d’un doublon', () => {
    const REPONSE_DOUBLONS: ReponseDoublonsClients = {
      candidats: [
        {
          clientId: 'cl-1',
          numeroClient: 'CL-000001',
          nom: 'Isabelle Rossi',
          npa: '1000',
          critere: 'nom_npa',
          score: 0.92,
        },
      ],
    };

    it('conserve `?site=` en ouvrant la fiche du doublon', async () => {
      server.use(http.get('/api/v1/doublons-clients', () => HttpResponse.json(REPONSE_DOUBLONS)));
      const utilisateur = userEvent.setup();
      const { routeur } = rendreFormulaire(vi.fn(), '/?site=site-1');

      await utilisateur.type(screen.getByLabelText('Nom'), 'Rossi');
      await utilisateur.click(await screen.findByRole('link', { name: 'Voir la fiche' }));

      expect(await screen.findByText('PAGE_FICHE_CLIENT')).toBeInTheDocument();
      expect(routeur.state.location.pathname).toBe('/clients/cl-1');
      expect(routeur.state.location.search).toBe('?site=site-1');
    });

    it('ne réinvente pas de `site` en ouvrant la fiche du doublon quand il est absent de l’URL', async () => {
      server.use(http.get('/api/v1/doublons-clients', () => HttpResponse.json(REPONSE_DOUBLONS)));
      const utilisateur = userEvent.setup();
      const { routeur } = rendreFormulaire(vi.fn(), '/');

      await utilisateur.type(screen.getByLabelText('Nom'), 'Rossi');
      await utilisateur.click(await screen.findByRole('link', { name: 'Voir la fiche' }));

      expect(await screen.findByText('PAGE_FICHE_CLIENT')).toBeInTheDocument();
      expect(routeur.state.location.search).toBe('');
    });
  });
});
