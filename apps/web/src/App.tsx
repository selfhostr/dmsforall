import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RouterProvider } from 'react-router';

import { SynchronisationLangue } from '@/composants/commun/SynchronisationLangue';
import { EcranErreurFatale } from '@/ecrans/systeme/EcranErreurFatale';
import { signalerErreur } from '@/observabilite/sentry';
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
    // Dernier filet avant écran blanc, doit rester visible en prod (`console.error` est
    // explicitement autorisé par la configuration ESLint du dépôt, règle `no-console`).
    console.error('Erreur non rattrapée dans l’arbre React :', erreur, info.componentStack);
    // `componentStack` ne contient que des noms de composants et des emplacements source,
    // jamais de props ni de données affichées — safe à joindre tel quel (nettoyerEvenement
    // s'applique de toute façon dessus avant tout envoi). Volontairement non attendue : un
    // crash de rendu ne doit jamais rester bloqué sur un aller-retour réseau vers Sentry.
    void signalerErreur(erreur, { componentStack: info.componentStack ?? undefined });
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
