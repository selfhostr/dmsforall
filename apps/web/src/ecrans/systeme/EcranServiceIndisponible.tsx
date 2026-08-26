import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { clesQuery } from '@/api/cles';
import { Button } from '@/components/ui/button';

/** Rendu quand `useSession` est en `isError` (le serveur n'a pas répondu au tout, ex. panne
 *  API) — surtout PAS l'écran de login : on ne sait pas si l'utilisateur a une session valide
 *  ou non, seulement que l'API est muette.
 *
 *  EXCEPTION MESURÉE, PAS `GabaritEcran` : `GabaritEcran` v2 consomme
 *  `useLibellesNavigationAffiches` -> `useNavigationActive` -> `useSession()` — un DEUXIÈME
 *  abonnement à la même requête `clesQuery.session()`, précisément celle qui est EN ERREUR quand
 *  cet écran s'affiche. Constaté en exécution (`routes/RouteProtegee.spec.tsx`, test « isError »)
 *  : avec `GabaritEcran`, le rendu reste bloqué sur `EcranVerificationSession` indéfiniment (testé
 *  jusqu'à 15 s, jamais résolu) puis une exception « window is not defined » survient après le
 *  démontage du test — un blocage, pas une simple lenteur. C'est exactement le pire endroit pour
 *  ce défaut : l'écran qui doit annoncer « le serveur ne répond pas » resterait lui-même bloqué
 *  quand le serveur ne répond pas. Défaut SIGNALÉ au socle (`composants/motifs/GabaritEcran.tsx`
 *  / `composants/layout/useNavigationActive.ts`), pas corrigé ici (hors périmètre) — h1 manuel
 *  conservé, sans dépendance à la navigation. */
export function EcranServiceIndisponible() {
  const { t } = useTranslation(['erreurs', 'commun']);
  const queryClient = useQueryClient();

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-sm space-y-4 text-center">
        <h1 className="texte-titre-page">{t('erreurs:serveur.titre')}</h1>
        <p className="texte-corps text-muted-foreground">{t('erreurs:serveur.description')}</p>
        <Button onClick={() => void queryClient.refetchQueries({ queryKey: clesQuery.session() })}>
          {t('commun:actions.reessayer')}
        </Button>
      </div>
    </div>
  );
}
