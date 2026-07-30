import { createBrowserRouter, type RouteObject } from 'react-router';

import { AppShell } from '@/composants/layout/AppShell';
import { EcranAccueil } from '@/ecrans/EcranAccueil';
import { EcranConnexion } from '@/ecrans/EcranConnexion';
import { EcranFicheOrdreReparation } from '@/ecrans/atelier/EcranFicheOrdreReparation';
import { EcranListeOrdresReparation } from '@/ecrans/atelier/EcranListeOrdresReparation';
import { EcranNouvelOrdreReparation } from '@/ecrans/atelier/EcranNouvelOrdreReparation';
import { EcranFicheClient } from '@/ecrans/clients/EcranFicheClient';
import { EcranListeClients } from '@/ecrans/clients/EcranListeClients';
import { EcranAvoir } from '@/ecrans/facturation/EcranAvoir';
import { EcranFacturerOrdreReparation } from '@/ecrans/facturation/EcranFacturerOrdreReparation';
import { EcranFicheFacture } from '@/ecrans/facturation/EcranFicheFacture';
import { EcranListeFactures } from '@/ecrans/facturation/EcranListeFactures';
import { EcranParametresFacturation } from '@/ecrans/parametrage/EcranParametresFacturation';
import { EcranRecherche } from '@/ecrans/recherche/EcranRecherche';
import { EcranPageIntrouvable } from '@/ecrans/systeme/EcranPageIntrouvable';
import { EcranFicheVehicule } from '@/ecrans/vehicules/EcranFicheVehicule';
import { EcranListeVehicules } from '@/ecrans/vehicules/EcranListeVehicules';

import { RouteProtegee } from './RouteProtegee';
import { RoutePublique } from './RoutePublique';

/**
 * Convention structurelle qui fait qu'une route oubliée tombe du côté SÛR (même principe que la
 * garde côté API) : la SEULE route publique de tout le tableau est `/login`, explicitement sous
 * `RoutePublique`. Tout le reste vit comme enfant de l'unique route protégée `/` (sous
 * `RouteProtegee` + `AppShell`) — c'est aussi l'endroit naturel où ajouter un futur écran, à côté
 * de ceux déjà listés ci-dessous, jamais un nouveau frère top-level du tableau : il n'y a tout
 * simplement pas d'autre emplacement « pratique » qui échapperait à l'authentification.
 *
 * Exporté séparément de `routeur` (créé juste en dessous) pour que les tests puissent construire
 * un `createMemoryRouter` avec exactement cette configuration (voir routeur.spec.tsx), plutôt que
 * de la dupliquer.
 */
export const routesConfig: RouteObject[] = [
  {
    path: '/login',
    element: (
      <RoutePublique>
        <EcranConnexion />
      </RoutePublique>
    ),
  },
  {
    path: '/',
    element: (
      <RouteProtegee>
        <AppShell />
      </RouteProtegee>
    ),
    children: [
      { index: true, element: <EcranAccueil /> },
      { path: 'recherche', element: <EcranRecherche /> },
      { path: 'clients', element: <EcranListeClients /> },
      { path: 'clients/:id', element: <EcranFicheClient /> },
      { path: 'vehicules', element: <EcranListeVehicules /> },
      { path: 'vehicules/:vehiculeId', element: <EcranFicheVehicule /> },
      { path: 'ordres-reparation', element: <EcranListeOrdresReparation /> },
      // Le paramètre s'appelle `orId` (pas `id`) pour matcher exactement ce que
      // `EcranFicheOrdreReparation` lit via `useParams<{ orId: string }>()` — sinon `orId` est
      // `undefined`, `useOrdreReparation` reste `enabled: false`, et la fiche reste bloquée en
      // chargement infini sans la moindre erreur. Sans risque pour les liens déjà posés (fiche
      // client, recherche) : ils construisent l'URL en chaîne (`/ordres-reparation/${id}`), le nom
      // du paramètre de route ne joue aucun rôle dans cette construction.
      { path: 'ordres-reparation/:orId', element: <EcranFicheOrdreReparation /> },
      // L'écran lit `?site=` et `?clientId=` en paramètres de requête (jamais de paramètre de
      // chemin ici) — voir EcranNouvelOrdreReparation.tsx pour le détail des deux repos honnêtes
      // affichés quand l'un des deux manque.
      { path: 'atelier/ordres-reparation/nouveau', element: <EcranNouvelOrdreReparation /> },
      // Même paramètre `orId` que la fiche d'OR ci-dessus (`EcranFacturerOrdreReparation` lit
      // `useParams<{ orId: string }>()`) et même préfixe `ordres-reparation/` que le reste de la
      // ressource — le commentaire en tête d'`EcranFacturerOrdreReparation.tsx` documente
      // `/or/:orId/facturer` (calque du design), mais rien dans le dépôt ne navigue déjà vers cette
      // URL : `/or/` n'existe nulle part ailleurs dans le routeur, alors que `ordres-reparation/`
      // est le préfixe déjà en place pour cette même ressource (liste, fiche). Choisi pour
      // cohérence avec les routes existantes plutôt que pour coller littéralement au commentaire.
      { path: 'ordres-reparation/:orId/facturer', element: <EcranFacturerOrdreReparation /> },
      { path: 'factures', element: <EcranListeFactures /> },
      // `:id` (pas `:orId` ni `:factureId`) — `EcranFicheFacture` lit `useParams<{ id: string }>()`.
      { path: 'factures/:id', element: <EcranFicheFacture /> },
      // Même remarque : `EcranAvoir` lit aussi `useParams<{ id: string }>()` — `id` y désigne la
      // facture d'origine à partir de laquelle l'avoir est émis, pas l'avoir lui-même (qui n'existe
      // pas encore au moment où cet écran s'ouvre). Chemin construit par les écrans appelants via
      // `` `/factures/${document.id}/avoir` `` (EcranFicheFacture, DialogueCorrectionFacture) — pas
      // de constructeur dans `chemins.ts` pour cette route, les écrans de facturation naviguent en
      // gabarit littéral plutôt que via `chemins.*`.
      { path: 'factures/:id/avoir', element: <EcranAvoir /> },
      // Singleton par tenant (bloc créancier du QR-facture) — jamais de paramètre de chemin,
      // voir `chemins.parametrage.facturation` et le commentaire de tête d'`EcranParametresFacturation`.
      { path: 'parametrage/facturation', element: <EcranParametresFacturation /> },
    ],
  },
  { path: '*', element: <EcranPageIntrouvable /> },
];

export const routeur = createBrowserRouter(routesConfig);
