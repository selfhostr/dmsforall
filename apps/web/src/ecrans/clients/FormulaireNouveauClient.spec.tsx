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
  it('affiche les erreurs de validation par champ à la soumission de données invalides, sans perte de saisie ni rejet silencieux', async () => {
    // Régression @hookform/resolvers + zod 4 : avec @hookform/resolvers@3.10.0, l'adaptateur zod
    // teste `Array.isArray(err?.errors)` pour convertir un ZodError en erreurs de champ RHF — or
    // zod 4 a supprimé l'alias `.errors` (seul `.issues` subsiste sur ZodError). Ce test étant
    // toujours faux, l'ancien adaptateur relançait le ZodError au lieu de peupler
    // `formState.errors`. Dans `handleSubmit` (react-hook-form), `const { errors, values } =
    // await _runSchema()` n'est entouré d'aucun try/catch : la promesse retournée par `soumettre`
    // (passée telle quelle à `onSubmit` du <form>) rejetait alors sans jamais être awaitée par
    // React — un rejet de promesse non géré — et aucun message d'erreur n'apparaissait jamais
    // dans le DOM. Avec l'ancien adaptateur, les `findByText` ci-dessous auraient expiré
    // (timeout), pas échoué immédiatement : la validation ne renvoyait jamais d'erreur de champ.
    server.use(
      http.get('/api/v1/doublons-clients', () =>
        HttpResponse.json({ candidats: [] } satisfies ReponseDoublonsClients),
      ),
    );
    const utilisateur = userEvent.setup();
    const { onCree } = rendreFormulaire();

    // Aucun champ requis rempli (nom, rue, npa, localité) : la validation zod doit échouer.
    await utilisateur.click(screen.getByRole('button', { name: 'Créer le client' }));

    // Les erreurs de champ apparaissent réellement dans le DOM (formState.errors peuplé), pas
    // seulement l'absence de throw.
    const erreursRequis = await screen.findAllByText('Ce champ est obligatoire.');
    expect(erreursRequis.length).toBeGreaterThanOrEqual(3); // nom, rue, npa, localité

    expect(screen.getByLabelText('Nom')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Rue et numéro')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('NPA')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Localité')).toHaveAttribute('aria-invalid', 'true');

    // La soumission n'a pas abouti — ni requête réseau, ni navigation.
    expect(onCree).not.toHaveBeenCalled();

    // La saisie n'est pas perdue : un champ déjà rempli reste rempli après l'échec de validation.
    await utilisateur.type(screen.getByLabelText('Nom'), 'Rossi');
    expect(screen.getByLabelText('Nom')).toHaveValue('Rossi');
  });

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
