import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

/** Rendu par le ErrorBoundary racine (App.tsx) sur un crash de rendu React. Pas de dépendance
 *  au routeur ni à TanStack Query : doit pouvoir s'afficher même si l'arbre au-dessus a
 *  planté.
 *
 *  EXCEPTION DÉLIBÉRÉE au chantier « titres doublés & espacements » (17.08.2026) : cet écran
 *  N'EST PAS passé par `GabaritEcran`. `App.tsx` monte `<EcranErreurFatale/>` en remplacement
 *  de `this.props.children` — qui contient `<RouterProvider>` lui-même — donc CET écran peut
 *  être rendu SANS AUCUN contexte routeur au-dessus de lui (c'est justement le cas qu'il doit
 *  couvrir : un crash pouvant survenir dans l'arbre du routeur). `GabaritEcran` détermine sa
 *  route courante pour la détection de doublon (§3 du contrat) : au moins un hook React Router
 *  y est donc nécessaire, ce qui ferait planter CE filet de sécurité précisément quand il est le
 *  plus nécessaire. Gardé en h1 manuel, visible, sans dépendance — signalé au socle : si
 *  `GabaritEcran` doit un jour couvrir ce cas, il lui faudra tolérer une absence totale de
 *  contexte routeur, pas juste une route hors arborescence. */
export function EcranErreurFatale() {
  const { t } = useTranslation(['erreurs', 'commun']);

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-sm space-y-4 text-center">
        <h1 className="texte-titre-page">{t('erreurs:fatale.titre')}</h1>
        <p className="texte-corps text-muted-foreground">{t('erreurs:fatale.description')}</p>
        <Button onClick={() => window.location.reload()}>
          {t('commun:actions.rechargerApplication')}
        </Button>
      </div>
    </div>
  );
}
