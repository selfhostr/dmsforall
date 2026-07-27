import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RouterProvider } from 'react-router';

import { SynchronisationLangue } from '@/composants/commun/SynchronisationLangue';
import { EcranErreurFatale } from '@/ecrans/systeme/EcranErreurFatale';
import { routeur } from '@/routes/routeur';

const queryClient = new QueryClient();

interface EtatLimiteErreur {
  readonly aPlante: boolean;
}

/** ErrorBoundary racine : tout crash de rendu React affiche EcranErreurFatale plutôt qu'un
 *  écran blanc. Volontairement une classe (seule API React pour capturer une erreur de rendu
 *  côté client à ce jour). */
class LimiteErreur extends Component<{ children: ReactNode }, EtatLimiteErreur> {
  override state: EtatLimiteErreur = { aPlante: false };

  static getDerivedStateFromError(): EtatLimiteErreur {
    return { aPlante: true };
  }

  override componentDidCatch(erreur: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console -- dernier filet avant écran blanc, doit rester visible en prod
    console.error('Erreur non rattrapée dans l’arbre React :', erreur, info.componentStack);
  }

  override render() {
    if (this.state.aPlante) return <EcranErreurFatale />;
    return this.props.children;
  }
}

export default function App() {
  return (
    <LimiteErreur>
      <QueryClientProvider client={queryClient}>
        <SynchronisationLangue />
        <RouterProvider router={routeur} />
      </QueryClientProvider>
    </LimiteErreur>
  );
}
