import { createBrowserRouter, type RouteObject } from 'react-router';

import { AppShell } from '@/composants/layout/AppShell';
import { EcranAccueil } from '@/ecrans/EcranAccueil';
import { EcranConnexion } from '@/ecrans/EcranConnexion';
import { EcranFicheOrdreReparation } from '@/ecrans/atelier/EcranFicheOrdreReparation';
import { EcranListeOrdresReparation } from '@/ecrans/atelier/EcranListeOrdresReparation';
import { EcranFicheClient } from '@/ecrans/clients/EcranFicheClient';
import { EcranListeClients } from '@/ecrans/clients/EcranListeClients';
import { EcranRecherche } from '@/ecrans/recherche/EcranRecherche';
import { EcranPageIntrouvable } from '@/ecrans/systeme/EcranPageIntrouvable';
import { EcranFicheVehicule } from '@/ecrans/vehicules/EcranFicheVehicule';
import { EcranListeVehicules } from '@/ecrans/vehicules/EcranListeVehicules';

import { EcranFonctionAVenir } from './EcranFonctionAVenir';
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
      // Pas d'écran de création d'OR à ce jour (hors périmètre) : repli honnête plutôt qu'un 404
      // qui laisserait croire à un lien cassé (la fiche client y navigue déjà).
      { path: 'atelier/ordres-reparation/nouveau', element: <EcranFonctionAVenir /> },
    ],
  },
  { path: '*', element: <EcranPageIntrouvable /> },
];

export const routeur = createBrowserRouter(routesConfig);
