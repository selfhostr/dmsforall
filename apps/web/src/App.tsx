import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, useTheme } from 'next-themes';
import { Component, type ErrorInfo, type ReactNode, useEffect } from 'react';
import { RouterProvider } from 'react-router';

import { doitReessayerParDefaut, FRAICHEUR_PAR_DEFAUT_MS } from '@/api/reessai';
import { gererEchecMutationSansTraitement } from '@/api/gestion-echecs-mutation';
import { afficherToastSuccesMutation } from '@/api/toast-succes-mutation';
import { SynchronisationDensite } from '@/composants/commun/SynchronisationDensite';
import { SynchronisationLangue } from '@/composants/commun/SynchronisationLangue';
import { FiletErreurMutation } from '@/composants/motifs/FiletErreurMutation';
import { ToastsSucces } from '@/composants/motifs/ToastsSucces';
import { enregistrerErreur } from '@/diagnostic/tampon';
import { EcranErreurFatale } from '@/ecrans/systeme/EcranErreurFatale';
import { signalerErreur } from '@/observabilite/sentry';
import { routeur } from '@/routes/routeur';

// `mutationCache` : filet de sécurité générique sur l'échec d'une mutation (issue #63), voir
// `gererEchecMutationSansTraitement` pour le mécanisme complet — n'affiche RIEN quand un écran a
// déjà traité l'erreur lui-même, quelle que soit la façon dont il l'a fait.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Évite de recharger à chaque montage d'écran ou retour sur l'onglet ce qui vient d'être lu ;
      // les hooks qui exigent plus (session, référentiels) posent leur propre `staleTime`.
      staleTime: FRAICHEUR_PAR_DEFAUT_MS,
      refetchOnWindowFocus: false,
      retry: doitReessayerParDefaut,
    },
  },
  mutationCache: new MutationCache({
    // Retour de succès déclaré par la mutation (`meta.succes`, `meta.annuler`) — sans `meta`,
    // rien. Voir `toast-succes-mutation.ts` et DESIGN.md « Retour après une action ».
    onSuccess: (donnees, variables, _onMutateResult, mutation) => {
      afficherToastSuccesMutation(donnees, variables, mutation);
    },
    onError: (erreur, _variables, _onMutateResult, mutation) => {
      gererEchecMutationSansTraitement(erreur, mutation);
    },
  }),
});

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
    enregistrerErreur(erreur);
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

/**
 * Couleur de la barre système (mobile, `<meta name="theme-color">`) — voir `index.html` pour la
 * valeur initiale (posée par le script anti-flash, avant tout rendu React). Ce composant prend le
 * relais APRÈS le montage : une bascule manuelle du thème (`BasculeTheme.tsx`) change la classe
 * `.dark`/`.light` sur `<html>`, mais ne touche à aucune balise `<meta>` — sans ce composant, la
 * barre d'état resterait figée sur la couleur du chargement initial après un changement de thème
 * en cours de session. Monté une seule fois, sous `<ThemeProvider>` (seul endroit où `useTheme()`
 * est utilisable), jamais démonté tant que l'app tourne.
 */
function SynchroniseCouleurBarreSysteme() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    // Valeurs alignées sur `--background` de chaque thème (`index.css`) — dupliquées ici en dur
    // plutôt que lues depuis une variable CSS : `theme-color` est lu par le SYSTÈME D'EXPLOITATION,
    // pas par une page rendue, `getComputedStyle` n'a donc aucune valeur calculée à offrir avant
    // que `<body>` n'existe. Les deux hex DOIVENT rester synchronisés avec `index.html` (chargement
    // initial) et `index.css` (`--background` de `:root`/`.dark`) si l'une des trois valeurs change.
    meta.setAttribute('content', resolvedTheme === 'dark' ? '#111113' : '#f0f0f3');
  }, [resolvedTheme]);

  return null;
}

export default function App() {
  return (
    <LimiteErreur>
      {/* Refonte visuelle, mode sombre — voir DESIGN.md. `attribute="class"` : pose `class="dark"`/
          `class="light"` sur `<html>`, ce que `@custom-variant dark` (`index.css`) et les jetons
          `.dark { ... }` attendent. `defaultTheme="system"` + `enableSystem` : au premier lancement
          (rien en `localStorage`), le produit suit la préférence système plutôt que de forcer le
          clair — cohérent avec `index.html` (script anti-flash, même logique). `storageKey`
          DOIT rester synchronisé avec la clé lue par ce script anti-flash — un renommage de l'un
          sans l'autre réintroduit le flash qu'ils suppriment ensemble.
          `disableTransitionOnChange` : sans lui, TOUTES les transitions de couleur du produit
          (`--default-transition-duration`, `index.css`) se rejouent d'un coup au changement de
          thème — des centaines d'éléments qui « fondent » en même temps, un artefact visuel, pas
          une animation voulue. `next-themes` coupe nativement les transitions le temps du
          changement (une feuille de style injectée puis retirée après un `requestAnimationFrame`
          double), sans code à écrire ici. */}
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        storageKey="dfa-theme"
        disableTransitionOnChange
      >
        <SynchroniseCouleurBarreSysteme />
        <QueryClientProvider client={queryClient}>
          <SynchronisationLangue />
          <SynchronisationDensite />
          <RouterProvider router={routeur} />
          <FiletErreurMutation />
          <ToastsSucces />
        </QueryClientProvider>
      </ThemeProvider>
    </LimiteErreur>
  );
}
