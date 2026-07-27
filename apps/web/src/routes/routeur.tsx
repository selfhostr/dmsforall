import { createBrowserRouter } from 'react-router';

import { AppShell } from '@/composants/layout/AppShell';
import { EcranAccueil } from '@/ecrans/EcranAccueil';
import { EcranConnexion } from '@/ecrans/EcranConnexion';
import { EcranPageIntrouvable } from '@/ecrans/systeme/EcranPageIntrouvable';

import { RouteProtegee } from './RouteProtegee';
import { RoutePublique } from './RoutePublique';

export const routeur = createBrowserRouter([
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
    children: [{ index: true, element: <EcranAccueil /> }],
  },
  { path: '*', element: <EcranPageIntrouvable /> },
]);
