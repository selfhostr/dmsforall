import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeAll, describe, expect, it } from 'vitest';

import type { ReponseVehicule } from '@dfa/shared';

import { server } from '@/test/msw/server';
import { renduAvecRoutes } from '@/test/utils';

import { EcranNouveauVehicule } from './EcranNouveauVehicule';

// jsdom (26.1, `src/test/environnementJsdomFetch.ts`) n'implémente PAS `ResizeObserver` — un vrai
// navigateur si. `@radix-ui/react-checkbox` (case « importé ») l'utilise inconditionnellement dès
// le montage (`CheckboxBubbleInput`, `useSize(control)`) pour synchroniser la taille de son input
// natif caché. Repéré ici plutôt que dans `src/test/setup.ts` (hors périmètre de cet agent, voir
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

    expect(screen.getByRole('heading', { name: 'Nouveau véhicule', level: 1 })).toBeInTheDocument();
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
      await screen.findByText("Une erreur interne s'est produite. Réessayez."),
    ).toBeInTheDocument();
    // La saisie n'est jamais perdue après un échec serveur (standard non négociable, CONTRIBUTING.md).
    expect(screen.getByLabelText('Marque')).toHaveValue('Volkswagen');
    expect(screen.getByLabelText('Modèle')).toHaveValue('Golf');
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
