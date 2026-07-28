import { createBrowserRouter, type RouteObject } from 'react-router';

import { AppShell } from '@/composants/layout/AppShell';
import { EcranAccueil } from '@/ecrans/EcranAccueil';
import { EcranConnexion } from '@/ecrans/EcranConnexion';
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
      // Voir la doc de EcranFonctionAVenir : le module Atelier (donc l'écran d'OR lui-même)
      // n'est pas encore écrit, mais ces deux chemins sont déjà des cibles de navigation réelles
      // (fiche client, recherche globale) — un 404 générique laisserait croire à un lien cassé.
      { path: 'ordres-reparation/:id', element: <EcranFonctionAVenir /> },
      { path: 'atelier/ordres-reparation/nouveau', element: <EcranFonctionAVenir /> },
    ],
  },
  { path: '*', element: <EcranPageIntrouvable /> },
];

export const routeur = createBrowserRouter(routesConfig);
