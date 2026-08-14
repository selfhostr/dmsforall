import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PageCurseur, ReponseRegleRelance, ReponseRelanceEnvoi } from '@dfa/shared';

import '@/i18n';

import { routesConfig } from '@/routes/routeur';
import { SESSION_TEST } from '@/test/msw/handlers';
import { server } from '@/test/msw/server';
import { renduAvecQueryClient, renduAvecRoutes } from '@/test/utils';

import { EcranRelances } from './EcranRelances';

const REGLE_FACTURE_ECHUE: ReponseRegleRelance = {
  typeRelance: 'facture_echue',
  actif: true,
  delaisJours: [10, 20, 30],
  canaux: ['email'],
  texteModeleId: null,
  prereglageAppliqueLe: '2026-08-01T08:00:00.000Z',
  creeLe: '2026-07-01T08:00:00.000Z',
  modifieLe: '2026-08-01T08:00:00.000Z',
};

// jsdom (26.1, `src/test/environnementJsdomFetch.ts`) n'implémente PAS `ResizeObserver` — un vrai
// navigateur si. Le formulaire de modification manuelle monte des cases `@radix-ui/react-checkbox`
// qui l'utilisent inconditionnellement au montage (`CheckboxBubbleInput`, `useSize(control)`).
// Même stub, scopé à ce fichier, que `routes/routeur.spec.tsx`/`EcranNouveauVehicule.spec.tsx`.
beforeAll(() => {
  if (!('ResizeObserver' in globalThis)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub;
  }
});

function rendre() {
  return renduAvecQueryClient(<EcranRelances />);
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

describe('EcranRelances — nominal', () => {
  it('affiche la règle du rappel facture échue quand elle est configurée', async () => {
    server.use(http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])));

    rendre();

    expect(await screen.findByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Relances automatiques' })).toBeInTheDocument();
    expect(screen.getByText('Palier 1', { exact: false })).toBeInTheDocument();
    expect(screen.getByText("10 jours après l'échéance", { exact: false })).toBeInTheDocument();
    expect(screen.getByText('E-mail')).toBeInTheDocument();
    expect(screen.getByText('Préréglage appliqué le 01.08.2026.')).toBeInTheDocument();
  });
});

describe('EcranRelances — état vide (aucune règle configurée)', () => {
  it('propose le préréglage recommandé et l’applique via le même PUT que la modification manuelle', async () => {
    let corpsRecu: unknown = null;
    server.use(
      http.get('/api/v1/relances/regles', () => HttpResponse.json([])),
      http.put('/api/v1/relances/regles/facture_echue', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json({
          ...REGLE_FACTURE_ECHUE,
          prereglageAppliqueLe: '2026-08-06T08:00:00.000Z',
        });
      }),
    );

    rendre();
    const utilisateur = userEvent.setup();

    expect(await screen.findByText('Aucune règle configurée')).toBeInTheDocument();
    const bouton = screen.getByRole('button', { name: 'Activer le préréglage recommandé' });
    await utilisateur.click(bouton);

    await waitFor(() =>
      expect(corpsRecu).toEqual({ actif: true, delaisJours: [10, 20, 30], canaux: ['email'] }),
    );
  });
});

describe('EcranRelances — état erreur', () => {
  it('affiche un message actionnable avec retry', async () => {
    server.use(
      http.get('/api/v1/relances/regles', () =>
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

    expect(await screen.findByText("Impossible d'afficher les relances")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });
});

describe('EcranRelances — déclenchement manuel', () => {
  it('planifier maintenant : appelle la mutation et affiche le bilan', async () => {
    server.use(
      http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])),
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
      http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])),
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

describe('EcranRelances — modification manuelle', () => {
  it('ouvre le formulaire pré-rempli, corrige un palier invalide puis enregistre', async () => {
    let corpsRecu: unknown = null;
    server.use(
      http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])),
      http.put('/api/v1/relances/regles/facture_echue', async ({ request }) => {
        corpsRecu = await request.json();
        return HttpResponse.json(REGLE_FACTURE_ECHUE);
      }),
    );

    rendre();
    const utilisateur = userEvent.setup();

    await utilisateur.click(await screen.findByRole('button', { name: 'Modifier la règle' }));

    const champsPaliers = screen.getAllByPlaceholderText('Jours');
    expect(champsPaliers).toHaveLength(3);

    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    await waitFor(() =>
      expect(corpsRecu).toEqual({ actif: true, delaisJours: [10, 20, 30], canaux: ['email'] }),
    );
  });

  it('refuse un palier retiré sans remplaçant quand la règle reste active (validation zod partagée)', async () => {
    server.use(http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])));

    rendre();
    const utilisateur = userEvent.setup();

    await utilisateur.click(await screen.findByRole('button', { name: 'Modifier la règle' }));

    for (const nom of ['Retirer le palier 3', 'Retirer le palier 2', 'Retirer le palier 1']) {
      await utilisateur.click(screen.getByRole('button', { name: nom }));
    }
    await utilisateur.click(screen.getByRole('button', { name: 'Enregistrer' }));

    expect(
      await screen.findByText('Ajoutez au moins un palier pour activer les rappels.'),
    ).toBeInTheDocument();
  });

  it('annuler referme le formulaire sans muter', async () => {
    server.use(http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])));

    rendre();
    const utilisateur = userEvent.setup();

    await utilisateur.click(await screen.findByRole('button', { name: 'Modifier la règle' }));
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toBeInTheDocument();

    await utilisateur.click(screen.getByRole('button', { name: 'Annuler' }));

    expect(screen.queryByRole('button', { name: 'Enregistrer' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Modifier la règle' })).toBeInTheDocument();
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
  it('état de chargement de l’historique, indépendant de la règle déjà affichée', async () => {
    server.use(
      http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])),
      http.get('/api/v1/relances/facturation/historique', async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return HttpResponse.json(PAGE_HISTORIQUE_VIDE);
      }),
    );

    rendre();

    await screen.findByText('Active');
    expect(screen.getByText("Historique d'envoi")).toBeInTheDocument();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);

    await waitFor(() => expect(screen.getByText('Aucune relance envoyée')).toBeInTheDocument());
  });

  it('état vide (aucune relance envoyée) : cas normal, pas une erreur', async () => {
    server.use(http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])));

    rendre();

    expect(await screen.findByText('Aucune relance envoyée')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Aucun rappel n'a encore été envoyé pour ce garage. L'historique apparaîtra ici dès le premier envoi.",
      ),
    ).toBeInTheDocument();
  });

  it('état erreur : actionnable avec retry, indépendant d’une règle chargée avec succès', async () => {
    server.use(
      http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])),
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
      http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])),
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
      http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])),
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
      http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])),
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
 * que `routeur.spec.tsx` (« /pieces/* refuse admin ») : un rôle hors `direction`/`comptable` doit
 * recevoir l'écran de refus DÉDIÉ, jamais le contenu réel.
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
      http.get('/api/v1/relances/regles', () => HttpResponse.json([REGLE_FACTURE_ECHUE])),
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
