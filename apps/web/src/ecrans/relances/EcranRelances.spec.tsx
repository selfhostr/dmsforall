import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it } from 'vitest';

import type { PageCurseur, ReponseRelanceEnvoi } from '@dfa/shared';

import '@/i18n';

import { routesConfig } from '@/routes/routeur';
import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { renduAvecQueryClient, renduAvecRoutes } from '@/test/utils';

import { EcranRelances } from './EcranRelances';

/** `GabaritEcran` résout sa détection automatique de doublon via `useNavigationActive`
 *  (`useLocation`/`useSearchParams`) — un Router de test est donc requis, même pour un rendu isolé
 *  de l'écran (`MemoryRouter` seul suffit, pas besoin du jeu de routes complet comme
 *  `renduAvecRoutes` ci-dessous, réservé aux tests de garde de rôle). */
function rendre() {
  return renduAvecQueryClient(
    <MemoryRouter initialEntries={['/relances']}>
      <EcranRelances />
    </MemoryRouter>,
  );
}

const PAGE_HISTORIQUE_VIDE: PageCurseur<ReponseRelanceEnvoi> = {
  donnees: [],
  curseurSuivant: null,
  limite: 50,
};

/** Défaut appliqué à CHAQUE test de ce fichier : `BlocTracabilite` (issue #136) appelle
 *  systématiquement `GET .../historique` au montage de l'écran — un handler par défaut évite de
 *  le répéter dans les describe qui ne testent rien de ce bloc (le serveur MSW refuse toute
 *  requête non gérée, `src/test/setup.ts::onUnhandledRequest: 'error'`). Les tests dédiés à
 *  l'historique, plus bas, l'écrasent avec `server.use(...)` — msw priorise le handler le plus
 *  récemment enregistré. */
beforeEach(() => {
  server.use(
    http.get('/api/v1/relances/facturation/historique', () =>
      HttpResponse.json(PAGE_HISTORIQUE_VIDE),
    ),
  );
});

describe('EcranRelances — déclenchement manuel', () => {
  it('planifier maintenant : appelle la mutation et affiche le bilan', async () => {
    server.use(
      http.post('/api/v1/relances/facturation/planifier', () =>
        HttpResponse.json({ creees: 3, ignorees: 1, encoreATraiter: false }),
      ),
    );

    rendre();
    const utilisateur = userEvent.setup();

    const bouton = await screen.findByRole('button', { name: 'Planifier maintenant' });
    await utilisateur.click(bouton);

    expect(await screen.findByText('3 rappels créés')).toBeInTheDocument();
    expect(screen.getByText('1 déjà planifié', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Tout est traité.')).toBeInTheDocument();
  });

  it('envoyer maintenant : appelle la mutation et affiche le bilan', async () => {
    server.use(
      http.post('/api/v1/relances/facturation/envoyer', () =>
        HttpResponse.json({ envoyees: 2, echouees: 0, annulees: 1, encoreATraiter: true }),
      ),
    );

    rendre();
    const utilisateur = userEvent.setup();

    const bouton = await screen.findByRole('button', { name: 'Envoyer maintenant' });
    await utilisateur.click(bouton);

    expect(await screen.findByText('2 rappels envoyés')).toBeInTheDocument();
    expect(screen.getByText('aucun échec', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('1 annulation', { exact: false })).toBeInTheDocument();
    expect(
      screen.getByText("D'autres rappels restent à envoyer — relancez pour continuer."),
    ).toBeInTheDocument();
  });
});

const ENVOI_REUSSI: ReponseRelanceEnvoi = {
  id: 'env-1',
  factureId: 'facture-1',
  factureNumero: 'F-2026-00042',
  palier: 1,
  canal: 'email',
  destinataire: 'client@exemple.ch',
  statutEnvoi: 'envoye',
  raisonEchec: null,
  envoyeLe: '2026-08-10T08:00:00.000Z',
};

const ENVOI_ECHOUE: ReponseRelanceEnvoi = {
  id: 'env-2',
  factureId: 'facture-1',
  factureNumero: 'F-2026-00042',
  palier: 2,
  canal: 'sms',
  destinataire: '+41791234567',
  statutEnvoi: 'echoue',
  raisonEchec: 'quota_depasse',
  envoyeLe: '2026-08-11T08:00:00.000Z',
};

/**
 * Issue #136 : le bloc `BlocTracabilite` affichait jusqu'ici une note statique (« s'affichera ici
 * dès que l'API… ») — ce bloc de tests prouve la liste RÉELLE, ses trois états, et le point
 * central de l'issue : chaque tentative d'envoi apparaît (jamais seulement la dernière), avec la
 * date, le palier, le destinataire réellement touché, et le résultat en langage compréhensible.
 */
describe('EcranRelances — historique d’envoi (issue #136)', () => {
  it('état de chargement de l’historique', async () => {
    server.use(
      http.get('/api/v1/relances/facturation/historique', async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return HttpResponse.json(PAGE_HISTORIQUE_VIDE);
      }),
    );

    rendre();

    expect(await screen.findByText("Historique d'envoi")).toBeInTheDocument();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);

    await waitFor(() => expect(screen.getByText('Aucune relance envoyée')).toBeInTheDocument());
  });

  it('état vide (aucune relance envoyée) : cas normal, pas une erreur', async () => {
    rendre();

    expect(await screen.findByText('Aucune relance envoyée')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Aucun rappel n'a encore été envoyé pour ce garage. L'historique apparaîtra ici dès le premier envoi.",
      ),
    ).toBeInTheDocument();
  });

  it('état erreur : actionnable avec retry', async () => {
    server.use(
      http.get('/api/v1/relances/facturation/historique', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur interne',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: 'req-hist-1',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );

    rendre();

    expect(await screen.findByText("Impossible d'afficher l'historique")).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Réessayer' }).length).toBeGreaterThan(0);
  });

  it('une ligne par TENTATIVE (jamais seulement la dernière) — date, palier, destinataire figé, canal et résultat', async () => {
    server.use(
      http.get('/api/v1/relances/facturation/historique', () =>
        HttpResponse.json({
          donnees: [ENVOI_REUSSI, ENVOI_ECHOUE],
          curseurSuivant: null,
          limite: 50,
        }),
      ),
    );

    rendre();

    await screen.findByText('client@exemple.ch');
    const lignes = screen.getAllByRole('row').slice(1); // exclut la ligne d'en-tête
    expect(lignes).toHaveLength(2);

    expect(within(lignes[0]!).getByText('10.08.2026')).toBeInTheDocument();
    expect(within(lignes[0]!).getByText('Palier 1')).toBeInTheDocument();
    expect(within(lignes[0]!).getByText('client@exemple.ch')).toBeInTheDocument();
    expect(within(lignes[0]!).getByText('E-mail')).toBeInTheDocument();
    expect(within(lignes[0]!).getByText('Envoyé')).toBeInTheDocument();

    expect(within(lignes[1]!).getByText('11.08.2026')).toBeInTheDocument();
    expect(within(lignes[1]!).getByText('Palier 2')).toBeInTheDocument();
    expect(within(lignes[1]!).getByText('+41791234567')).toBeInTheDocument();
    expect(within(lignes[1]!).getByText('Échoué')).toBeInTheDocument();
    expect(
      within(lignes[1]!).getByText("Quota d'envoi dépassé ou erreur technique du prestataire"),
    ).toBeInTheDocument();
  });

  it('raisonEchec absent (format inattendu côté API) : libellé générique, jamais un plantage d’affichage', async () => {
    server.use(
      http.get('/api/v1/relances/facturation/historique', () =>
        HttpResponse.json({
          donnees: [{ ...ENVOI_ECHOUE, raisonEchec: null }],
          curseurSuivant: null,
          limite: 50,
        }),
      ),
    );

    rendre();

    expect(await screen.findByText('Échec — raison indisponible')).toBeInTheDocument();
  });

  it('charger plus : ajoute la page suivante sans perdre la première (curseur, jamais un numéro de page)', async () => {
    server.use(
      http.get('/api/v1/relances/facturation/historique', ({ request }) => {
        const curseur = new URL(request.url).searchParams.get('curseur');
        if (!curseur) {
          return HttpResponse.json({
            donnees: [ENVOI_REUSSI],
            curseurSuivant: 'curseur-page-2',
            limite: 50,
          });
        }
        return HttpResponse.json({ donnees: [ENVOI_ECHOUE], curseurSuivant: null, limite: 50 });
      }),
    );

    rendre();
    const utilisateur = userEvent.setup();

    await screen.findByText('client@exemple.ch');
    expect(screen.getAllByRole('row')).toHaveLength(2);

    await utilisateur.click(screen.getByRole('button', { name: 'Charger plus' }));

    await waitFor(() => expect(screen.getAllByRole('row')).toHaveLength(3));
    expect(screen.getByText('client@exemple.ch')).toBeInTheDocument();
    expect(screen.getByText('+41791234567')).toBeInTheDocument();
  });
});

/**
 * Câblage route + masquage par rôle (`ROLES_RELANCES`, `routes/droits-routes.ts`) — même patron
 * que `routeur.spec.tsx` (« /pieces/* refuse admin ») et que `EcranReglagesRelances.spec.tsx` pour
 * la route jumelle `/parametrage/relances` : un rôle hors `direction`/`comptable` doit recevoir
 * l'écran de refus DÉDIÉ, jamais le contenu réel.
 */
describe('routeur — /relances refuse les rôles hors direction/comptable', () => {
  it('technicien : reçoit l’écran de refus dédié, jamais le contenu réel', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json({
          ...SESSION_TEST,
          utilisateur: { ...SESSION_TEST.utilisateur, role: 'technicien' },
        }),
      ),
    );
    renduAvecRoutes(routesConfig, { routeInitiale: '/relances' });

    expect(
      await screen.findByText("Vous n'avez pas les droits pour cette action."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Relances automatiques' }),
    ).not.toBeInTheDocument();
  });

  it('direction : atteint le contenu réel de /relances', async () => {
    server.use(
      http.get('/api/v1/auth/moi', () =>
        HttpResponse.json({
          ...SESSION_TEST,
          utilisateur: { ...SESSION_TEST.utilisateur, role: 'direction' },
        }),
      ),
    );
    renduAvecRoutes(routesConfig, { routeInitiale: '/relances' });

    expect(
      await screen.findByRole('heading', { name: 'Relances automatiques' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Vous n'avez pas les droits pour cette action."),
    ).not.toBeInTheDocument();
  });
});
