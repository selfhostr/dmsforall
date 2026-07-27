import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { clesQuery } from '@/api/cles';
import { Button } from '@/components/ui/button';

/** Rendu quand `useSession` est en `isError` (le serveur n'a pas répondu au tout, ex. panne
 *  API) — surtout PAS l'écran de login : on ne sait pas si l'utilisateur a une session valide
 *  ou non, seulement que l'API est muette. */
export function EcranServiceIndisponible() {
  const { t } = useTranslation(['erreurs', 'commun']);
  const queryClient = useQueryClient();

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-sm space-y-4 text-center">
        <h1 className="text-lg font-semibold">{t('erreurs:serveur.titre')}</h1>
        <p className="text-muted-foreground">{t('erreurs:serveur.description')}</p>
        <Button onClick={() => void queryClient.refetchQueries({ queryKey: clesQuery.session() })}>
          {t('commun:actions.reessayer')}
        </Button>
      </div>
    </div>
  );
}
