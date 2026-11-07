import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  ReponseMarquesVehiculesCh,
  ReponseModelesVehiculesCh,
  ReponseVehicule,
} from '@dfa/shared';

import { server } from '@/test/msw/server';
import { renduAvecRoutes } from '@/test/utils';

import { EcranNouveauVehicule } from './EcranNouveauVehicule';

// Handlers par défaut pour l'autocomplétion marque/modèle (référentiel véhicules suisse) :
// SANS eux, la moindre saisie dans « Marque »/« Modèle » déclenche — 300 ms plus tard, après le
// débounce de `ChampAutocompletionVehicule` — une requête `GET /referentiels/vehicules/*` non
// interceptée, qui casse la suite (`onUnhandledRequest: 'error'`, `src/test/setup.ts`). Réinstallés
// à CHAQUE test (`beforeEach`, pas `beforeAll`) : `server.resetHandlers()` (`afterEach` global) les
// efface tous après chaque test. Tests dédiés plus bas surchargent ce défaut au cas par cas.
beforeEach(() => {
  server.use(
    http.get('/api/v1/referentiels/vehicules/marques', () =>
      HttpResponse.json({ marques: [] } satisfies ReponseMarquesVehiculesCh),
    ),
    http.get('/api/v1/referentiels/vehicules/modeles', () =>
      HttpResponse.json({ modeles: [] } satisfies ReponseModelesVehiculesCh),
    ),
  );
});

// jsdom (26.1, `src/test/environnementJsdomFetch.ts`) n'implémente PAS `ResizeObserver` — un vrai
// navigateur si. `@radix-ui/react-checkbox` (case « importé ») l'utilise inconditionnellement dès
// le montage (`CheckboxBubbleInput`, `useSize(control)`) pour synchroniser la taille de son input
// natif caché. Repéré ici plutôt que dans `src/test/setup.ts` (hors périmètre de ce lot, voir
// consigne de la tâche) : stub scopé à ce fichier, sans effet sur les autres suites.
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

const VEHICULE_CREE: ReponseVehicule = {
  id: 'veh-42',
  vin: null,
  marque: 'Volkswagen',
  modele: 'Golf',
  version: null,
  finition: null,
  codeTypeCh: null,
  premiereMiseEnCirculationLe: null,
  designation: 'Volkswagen Golf',
  plaque: null,
  canton: null,
  carburant: null,
  cylindreeCm3: null,
  puissanceKw: null,
  boite: null,
  transmission: null,
  normeEmission: null,
  couleur: null,
  codeCouleur: null,
  poidsVideKg: null,
  poidsTotalKg: null,
  places: null,
  pneusEte: null,
  pneusHiver: null,
  pressionPneus: null,
  huileType: null,
  huileQuantiteDl: null,
  batterie: null,
  codeRadio: null,
  codeCle: null,
  intervalleEntretienKm: null,
  intervalleEntretienMois: null,
  importe: { estImporte: false, paysOrigine: null, importeLe: null },
  garantieConstructeur: null,
  garantieGarage: null,
  proprietaireEconomiqueClientId: null,
  conducteurHabituel: null,
  identificationIncomplete: true,
  statut: 'actif',
  motifArchivage: null,
  fusionneVersVehiculeId: null,
  emplacementLibre: null,
  emplacementMajLe: null,
  creeLe: '2026-08-04T08:00:00.000Z',
  modifieLe: '2026-08-04T08:00:00.000Z',
};

function rendreEcran(routeInitiale = '/') {
  return renduAvecRoutes(
    [
      { path: '/', element: <EcranNouveauVehicule /> },
      { path: '/vehicules', element: <div>PAGE_LISTE_VEHICULES</div> },
      { path: '/vehicules/:vehiculeId', element: <div>PAGE_FICHE_VEHICULE</div> },
    ],
    { routeInitiale },
  );
}

async function remplirIdentiteMinimale(utilisateur: ReturnType<typeof userEvent.setup>) {
  await utilisateur.type(screen.getByLabelText('Marque'), 'Volkswagen');
  await utilisateur.type(screen.getByLabelText('Modèle'), 'Golf');
}

describe('EcranNouveauVehicule', () => {
  it('affiche le titre et les champs d’identité minimale (marque, modèle) — les champs avancés restent sur la fiche', () => {
    rendreEcran();

    // Chantier « titres doublés & espacements » (17.08.2026) : écran de CRÉATION — le titre reste
    // VISIBLE (aucune inclusion entre « Nouveau véhicule » et l'onglet actif « Véhicules », même
    // logique que « Nouvelle commande fournisseur » face à « Commandes » dans le contrat du
    // chantier), `toBeVisible()` est ici fiable (h1 sans classe `sr-only`).
    const titre = screen.getByRole('heading', { name: 'Nouveau véhicule', level: 1 });
    expect(titre).toBeInTheDocument();
    expect(titre).toBeVisible();
    expect(screen.getByLabelText('Marque')).toBeInTheDocument();
    expect(screen.getByLabelText('Modèle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Créer le véhicule' })).toBeInTheDocument();
    // Champs avancés (garantie, données d'atelier…) absents de ce formulaire — modifiables depuis
    // la fiche après création seulement, même philosophie que `FormulaireNouveauClient`.
    expect(screen.queryByLabelText('Batterie')).not.toBeInTheDocument();
  });

  it("envoie l'Idempotency-Key à la création et navigue vers la fiche du véhicule créé", async () => {
    let cleRecue: string | null = null;
    let corpsRecu: Record<string, unknown> | null = null;
    server.use(
      http.post('/api/v1/vehicules', async ({ request }) => {
        cleRecue = request.headers.get('Idempotency-Key');
        corpsRecu = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ donnees: VEHICULE_CREE, avertissements: [] }, { status: 201 });
      }),
    );
    const utilisateur = userEvent.setup();
    const { routeur } = rendreEcran();

    await remplirIdentiteMinimale(utilisateur);
    await utilisateur.click(screen.getByRole('button', { name: 'Créer le véhicule' }));

    expect(await screen.findByText('PAGE_FICHE_VEHICULE')).toBeInTheDocument();
    expect(routeur.state.location.pathname).toBe('/vehicules/veh-42');
    expect(cleRecue).toMatch(/^[0-9a-f-]{36}$/);
    expect(corpsRecu).toMatchObject({ marque: 'Volkswagen', modele: 'Golf' });
  });

  it("conserve `?site=` en annulant vers la liste, et ne l'invente pas quand il est absent", async () => {
    const utilisateur = userEvent.setup();
    const { routeur } = rendreEcran('/?site=site-1');

    await utilisateur.click(screen.getByRole('link', { name: 'Annuler' }));

    expect(await screen.findByText('PAGE_LISTE_VEHICULES')).toBeInTheDocument();
    expect(routeur.state.location.search).toBe('?site=site-1');
  });

  it('affiche une erreur actionnable (jamais un écran cassé) quand la création échoue côté serveur, sans perdre la saisie', async () => {
    server.use(
      http.post('/api/v1/vehicules', () =>
        HttpResponse.json(
          {
            type: 'https://docs.dmsforall.example/erreurs/ERREUR_INTERNE',
            title: 'Erreur',
            status: 500,
            code: 'ERREUR_INTERNE',
            instance: 'req-1',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    const utilisateur = userEvent.setup();
    rendreEcran();

    await remplirIdentiteMinimale(utilisateur);
    await utilisateur.click(screen.getByRole('button', { name: 'Créer le véhicule' }));

    expect(
      await screen.findByText(
        "Un problème inattendu est survenu. Réessayez dans un instant ; s'il revient, prévenez le support en indiquant l'heure.",
      ),
    ).toBeInTheDocument();
    // La saisie n'est jamais perdue après un échec serveur (standard non négociable, CONTRIBUTING.md).
    expect(screen.getByLabelText('Marque')).toHaveValue('Volkswagen');
    expect(screen.getByLabelText('Modèle')).toHaveValue('Golf');
  });

  describe('collision de plaque (issue #96)', () => {
    it('nomme le véhicule fautif et propose un lien vers sa fiche quand le serveur fournit le détail', async () => {
      server.use(
        http.post('/api/v1/vehicules', () =>
          HttpResponse.json(
            {
              type: 'https://docs.dmsforall.example/erreurs/VEHICULE_PLAQUE_COLLISION',
              title: 'Plaque déjà attribuée',
              status: 409,
              code: 'VEHICULE_PLAQUE_COLLISION',
              instance: 'req-1',
              // `blocages[0].id` vaut `'plaque'` sur CETTE route (nom du champ dans
              // `EntreeCreationVehicule`) — jamais `'valeur'` (`POST /vehicules/{id}/plaques`,
              // `DialogueModifierIdentiteVehicule`) : convention documentée par
              // `DetailCollisionPlaqueVehicule`, l'écran ne doit brancher que sur le `code`.
              blocages: [
                {
                  type: 'champ',
                  id: 'plaque',
                  libelle: 'Plaque déjà portée par le véhicule Volkswagen Golf VII Comfortline',
                  donnees: {
                    vehiculeId: 'veh-golf-existant',
                    marque: 'Volkswagen',
                    modele: 'Golf VII',
                    version: 'Comfortline',
                    plaque: '999999',
                    canton: 'VD',
                    debutLe: '2026-03-12',
                    finLe: null,
                  },
                },
              ],
            },
            { status: 409, headers: { 'content-type': 'application/problem+json' } },
          ),
        ),
      );
      const utilisateur = userEvent.setup();
      rendreEcran();

      await remplirIdentiteMinimale(utilisateur);
      await utilisateur.type(screen.getByLabelText('Plaque'), '999999');
      await utilisateur.click(screen.getByRole('button', { name: 'Créer le véhicule' }));

      expect(
        await screen.findByText(
          'Plaque 999999 déjà portée par Volkswagen Golf VII Comfortline depuis le 12.03.2026.',
        ),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Voir ce véhicule' })).toHaveAttribute(
        'href',
        '/vehicules/veh-golf-existant',
      );
      // Jamais dans le bandeau générique — même doctrine que `DialogueModifierIdentiteVehicule`.
      expect(
        screen.queryByText(
          "Un problème inattendu est survenu. Réessayez dans un instant ; s'il revient, prévenez le support en indiquant l'heure.",
        ),
      ).not.toBeInTheDocument();
      // La saisie survit à l'échec, standard non négociable (CONTRIBUTING.md).
      expect(screen.getByLabelText('Plaque')).toHaveValue('999999');
    });

    it('affiche un message sobre, jamais un libellé à trous, quand le serveur ne fournit aucun détail (course rare)', async () => {
      server.use(
        http.post('/api/v1/vehicules', () =>
          HttpResponse.json(
            {
              type: 'https://docs.dmsforall.example/erreurs/VEHICULE_PLAQUE_COLLISION',
              title: 'Plaque déjà attribuée',
              status: 409,
              code: 'VEHICULE_PLAQUE_COLLISION',
              instance: 'req-1',
            },
            { status: 409, headers: { 'content-type': 'application/problem+json' } },
          ),
        ),
      );
      const utilisateur = userEvent.setup();
      rendreEcran();

      await remplirIdentiteMinimale(utilisateur);
      await utilisateur.type(screen.getByLabelText('Plaque'), '999999');
      await utilisateur.click(screen.getByRole('button', { name: 'Créer le véhicule' }));

      expect(
        await screen.findByText('Cette plaque est déjà attribuée à un autre véhicule.'),
      ).toBeInTheDocument();
      expect(screen.queryByText(/^Plaque .* déjà portée par/)).not.toBeInTheDocument();
    });
  });

  describe('autocomplétion marque/modèle (référentiel véhicules suisse)', () => {
    it('propose des marques après une frappe partielle, puis conditionne les modèles suggérés à la marque choisie', async () => {
      server.use(
        http.get('/api/v1/referentiels/vehicules/marques', ({ request }) => {
          const recherche = new URL(request.url).searchParams.get('recherche');
          if (recherche?.toLowerCase() !== 'volksw') return HttpResponse.json({ marques: [] });
          return HttpResponse.json({
            marques: [{ nom: 'Volkswagen', nombreModeles: 42, aliasTrouve: null }],
          } satisfies ReponseMarquesVehiculesCh);
        }),
        http.get('/api/v1/referentiels/vehicules/modeles', ({ request }) => {
          const url = new URL(request.url);
          if (url.searchParams.get('marque') !== 'Volkswagen')
            return HttpResponse.json({ modeles: [] });
          return HttpResponse.json({
            modeles: [{ nom: 'Golf', codeTypeCh: null }],
          } satisfies ReponseModelesVehiculesCh);
        }),
      );
      const utilisateur = userEvent.setup();
      rendreEcran();

      await utilisateur.type(screen.getByLabelText('Marque'), 'volksw');
      const optionMarque = await screen.findByRole('option', { name: /Volkswagen/ });
      await utilisateur.click(optionMarque);

      expect(screen.getByLabelText('Marque')).toHaveValue('Volkswagen');

      await utilisateur.click(screen.getByLabelText('Modèle'));
      const optionModele = await screen.findByRole('option', { name: 'Golf' });
      await utilisateur.click(optionModele);

      expect(screen.getByLabelText('Modèle')).toHaveValue('Golf');
    });

    it('une marque absente du référentiel reste saisissable librement et aboutit à un véhicule enregistré — le repli manuel est un chemin de premier rang', async () => {
      let corpsRecu: Record<string, unknown> | null = null;
      server.use(
        http.get('/api/v1/referentiels/vehicules/marques', () =>
          HttpResponse.json({ marques: [] } satisfies ReponseMarquesVehiculesCh),
        ),
        http.post('/api/v1/vehicules', async ({ request }) => {
          corpsRecu = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json(
            {
              donnees: { ...VEHICULE_CREE, marque: 'Garage Import Zoug', modele: 'Modèle maison' },
              avertissements: [],
            },
            { status: 201 },
          );
        }),
      );
      const utilisateur = userEvent.setup();
      rendreEcran();

      const champMarque = screen.getByLabelText('Marque');
      await utilisateur.type(champMarque, 'Garage Import Zoug');
      await utilisateur.tab(); // perte de focus : c'est seulement là que le repli visible s'affiche.
      await waitFor(() =>
        expect(screen.getByText(/Ne figure pas dans le référentiel/)).toBeInTheDocument(),
      );
      await utilisateur.type(screen.getByLabelText('Modèle'), 'Modèle maison');

      await utilisateur.click(screen.getByRole('button', { name: 'Créer le véhicule' }));

      await waitFor(() =>
        expect(corpsRecu).toMatchObject({ marque: 'Garage Import Zoug', modele: 'Modèle maison' }),
      );
    });

    it('changer explicitement de marque réinitialise le modèle déjà saisi', async () => {
      server.use(
        http.get('/api/v1/referentiels/vehicules/marques', () =>
          HttpResponse.json({
            marques: [
              { nom: 'Volkswagen', nombreModeles: 42, aliasTrouve: null },
              { nom: 'Volvo', nombreModeles: 18, aliasTrouve: null },
            ],
          } satisfies ReponseMarquesVehiculesCh),
        ),
      );
      const utilisateur = userEvent.setup();
      rendreEcran();

      await utilisateur.type(screen.getByLabelText('Modèle'), 'Golf');
      expect(screen.getByLabelText('Modèle')).toHaveValue('Golf');

      await utilisateur.type(screen.getByLabelText('Marque'), 'Vo');
      const optionVolvo = await screen.findByRole('option', { name: /Volvo/ });
      await utilisateur.click(optionVolvo);

      expect(screen.getByLabelText('Modèle')).toHaveValue('');
    });
  });

  // Pas de test « soumission vide -> erreurs de champ affichées » ici : un défaut PRÉEXISTANT et
  // HORS PÉRIMÈTRE de cet écran l'empêche de s'exécuter proprement. `zod@4.4.3` (installé,
  // `packages/shared` exige `^4.1.12`) ne pose plus d'alias `.errors` sur `ZodError` (seul
  // `.issues` subsiste) ; `@hookform/resolvers@3.10.0` (`apps/web/package.json`) teste pourtant
  // `Array.isArray(err?.errors)` dans son adaptateur zod pour convertir un échec de validation en
  // erreurs de champ RHF — la condition est désormais toujours fausse, et le `ZodError` est
  // RE-LANCÉ tel quel comme rejet de promesse NON INTERCEPTÉ, plutôt que d'alimenter
  // `form.formState.errors`. Reproduit à l'identique sur `FormulaireNouveauClient` (même
  // `zodResolver`, même schéma partagé) — ce n'est donc pas un défaut de ce formulaire ni de son
  // schéma, mais une incompatibilité de versions transverse à TOUT formulaire zod+RHF du dépôt.
  // Correctif hors périmètre (versions de `@hookform/resolvers` dans `apps/web/package.json`,
  // partagées par tous les écrans) — signalé au coordinateur plutôt que corrigé ici.
});
