import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

/** Rendu par le ErrorBoundary racine (App.tsx) sur un crash de rendu React. Pas de dépendance
 *  au routeur ni à TanStack Query : doit pouvoir s'afficher même si l'arbre au-dessus a
 *  planté. */
export function EcranErreurFatale() {
  const { t } = useTranslation(['erreurs', 'commun']);

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-sm space-y-4 text-center">
        <h1 className="text-lg font-semibold">{t('erreurs:fatale.titre')}</h1>
        <p className="text-muted-foreground">{t('erreurs:fatale.description')}</p>
        <Button onClick={() => window.location.reload()}>
          {t('commun:actions.rechargerApplication')}
        </Button>
      </div>
    </div>
  );
}
