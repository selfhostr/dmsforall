import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import type { ReponseDoublonsClients } from '@dfa/shared';

import '@/i18n';
import i18n from '@/i18n';

import { server } from '@/test/msw/server';
import { renduAvecRoutes } from '@/test/utils';

import { EcranDoublonsClients } from './EcranDoublonsClients';

function rendreEcran(routeInitiale = '/') {
  return renduAvecRoutes(
    [
      { path: '/', element: <EcranDoublonsClients /> },
      { path: '/clients/:id', element: <div>PAGE_FICHE_CLIENT</div> },
    ],
    { routeInitiale },
  );
}

const REPONSE_UN_CANDIDAT: ReponseDoublonsClients = {
  candidats: [{ clientId: 'cl-1', numeroClient: 'CL-000001', nom: 'Isabelle Rossi', npa: '1000', critere: 'nom_npa', score: 0.92 }],
};

describe('EcranDoublonsClients', () => {
  afterEach(async () => {
    await i18n.changeLanguage('fr');
  });

  it('traduit le titre, les champs et l’état vide en italien (namespace `clients`, clés ajoutées par cet écran)', async () => {
    await i18n.changeLanguage('it');
    rendreEcran();

    expect(await screen.findByText('Duplicati clienti')).toBeInTheDocument();
    expect(screen.getByLabelText('Nome o ragione sociale')).toBeInTheDocument();
    expect(screen.getByText('Inserisci almeno un criterio di ricerca')).toBeInTheDocument();
  });

  it("affiche l'état « aucun critère » avant toute saisie, sans appeler le serveur", () => {
    rendreEcran();
    expect(screen.getByText('Saisissez au moins un critère de recherche')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('ne déclenche pas de recherche pour un nom trop court (min. 2 caractères, RM-05)', async () => {
    server.use(http.get('/api/v1/doublons-clients', () => HttpResponse.json({ candidats: [] } satisfies ReponseDoublonsClients)));
    const utilisateur = userEvent.setup();
    rendreEcran();

    await utilisateur.type(screen.getByLabelText('Nom ou raison sociale'), 'R');

    // Le champ reste sous le seuil `min(2)` du contrat : toujours l'état « aucun critère », jamais
    // un aller-retour serveur ni un chargement.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    expect(screen.getByText('Saisissez au moins un critère de recherche')).toBeInTheDocument();
  });

  it('affiche les candidats trouvés avec critère et score, et conserve `?site=` sur le lien', async () => {
    server.use(http.get('/api/v1/doublons-clients', () => HttpResponse.json(REPONSE_UN_CANDIDAT)));
    const utilisateur = userEvent.setup();
    const { routeur } = rendreEcran('/?site=site-1');

    await utilisateur.type(screen.getByLabelText('Nom ou raison sociale'), 'Rossi');

    expect(await screen.findByText(/Isabelle Rossi/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('CL-000001')).toBeInTheDocument();
    expect(screen.getByText(/Nom et NPA/)).toBeInTheDocument();
    expect(screen.getByText(/92 %/)).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('link', { name: 'Voir la fiche' }));
    expect(await screen.findByText('PAGE_FICHE_CLIENT')).toBeInTheDocument();
    expect(routeur.state.location.pathname).toBe('/clients/cl-1');
    expect(routeur.state.location.search).toBe('?site=site-1');
  });

  it('affiche un état vide POSITIF (« aucun doublon détecté ») quand la recherche ne remonte rien — cas nominal', async () => {
    server.use(http.get('/api/v1/doublons-clients', () => HttpResponse.json({ candidats: [] } satisfies ReponseDoublonsClients)));
    const utilisateur = userEvent.setup();
    rendreEcran();

    await utilisateur.type(screen.getByLabelText('Nom ou raison sociale'), 'Introuvable');

    // `findByText`, pas `findByRole('status')` : `EtatChargement` (squelette transitoire) porte
    // aussi `role="status"`, une requête par rôle serait ambiguë le temps du chargement.
    expect(await screen.findByText('Aucun doublon détecté', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('Aucun client existant ne correspond à ces critères.')).toBeInTheDocument();
  });

  it('affiche une erreur actionnable avec bouton réessayer si la recherche échoue', async () => {
    let tentatives = 0;
    server.use(
      http.get('/api/v1/doublons-clients', () => {
        tentatives += 1;
        if (tentatives === 1) {
          return HttpResponse.json(
            {
              type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
              title: 'Erreur interne',
              status: 500,
              code: 'ERREUR_INTERNE',
              instance: 'req-1',
            },
            { status: 500, headers: { 'content-type': 'application/problem+json' } },
          );
        }
        return HttpResponse.json(REPONSE_UN_CANDIDAT);
      }),
    );
    const utilisateur = userEvent.setup();
    rendreEcran();

    await utilisateur.type(screen.getByLabelText('Nom ou raison sociale'), 'Rossi');

    await utilisateur.click(await screen.findByRole('button', { name: 'Réessayer' }, { timeout: 3000 }));

    await waitFor(() => expect(screen.getByText(/Isabelle Rossi/)).toBeInTheDocument());
  });

  it("n'envoie pas un IDE incomplet au serveur (format `CHE-123.456.789` requis)", async () => {
    let appele = false;
    server.use(
      http.get('/api/v1/doublons-clients', () => {
        appele = true;
        return HttpResponse.json({ candidats: [] } satisfies ReponseDoublonsClients);
      }),
    );
    const utilisateur = userEvent.setup();
    rendreEcran();

    await utilisateur.type(screen.getByLabelText('IDE'), 'CHE-123');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });

    expect(appele).toBe(false);
    expect(screen.getByText('Saisissez au moins un critère de recherche')).toBeInTheDocument();
  });
});
