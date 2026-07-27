import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';

import '@/i18n';

/** QueryClient de test : pas de retry (les scénarios d'erreur doivent échouer immédiatement,
 *  pas après plusieurs tentatives silencieuses). */
export function creerQueryClientTest(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

interface OptionsRenduAvecProviders {
  readonly queryClient?: QueryClient;
  readonly routeInitiale?: string;
}

/** Rend un élément enveloppé du QueryClientProvider — sans routeur, pour tester un composant
 *  isolé (ex. EcranConnexion appelé directement). */
export function renduAvecQueryClient(
  element: ReactElement,
  options: OptionsRenduAvecProviders = {},
): RenderResult & { queryClient: QueryClient } {
  const queryClient = options.queryClient ?? creerQueryClientTest();
  return {
    queryClient,
    ...render(<QueryClientProvider client={queryClient}>{element}</QueryClientProvider>),
  };
}

interface OptionsRenduAvecRoutes {
  readonly queryClient?: QueryClient;
  readonly routeInitiale?: string;
}

/** Rend un jeu de routes react-router (mémoire, sans navigateur réel) enveloppé du
 *  QueryClientProvider — utilisé pour tester RouteProtegee/RoutePublique en conditions
 *  réelles de navigation (redirections comprises). */
export function renduAvecRoutes(
  routes: Parameters<typeof createMemoryRouter>[0],
  options: OptionsRenduAvecRoutes = {},
): RenderResult & {
  queryClient: QueryClient;
  routeur: ReturnType<typeof createMemoryRouter>;
} {
  const queryClient = options.queryClient ?? creerQueryClientTest();
  const routeur = createMemoryRouter(routes, {
    initialEntries: [options.routeInitiale ?? '/'],
  });
  return {
    queryClient,
    routeur,
    ...render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={routeur} />
      </QueryClientProvider>,
    ),
  };
}

export function EnveloppeTest({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={creerQueryClientTest()}>{children}</QueryClientProvider>;
}
