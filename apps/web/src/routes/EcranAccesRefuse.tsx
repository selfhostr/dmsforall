import { ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';

/**
 * Rendu par `RouteProtegee` quand `rolesAutorises` est posé et que le rôle de la session
 * courante n'y figure pas (voir RouteProtegee.tsx) — ex. un `technicien` qui atteint
 * `/parametrage/referentiels`. Même patron que `EcranFonctionAVenir` (repli générique vivant
 * dans `routes/`, pas dans `ecrans/**`, exclu du scan de couverture de `routeur.spec.tsx` au
 * même titre que `ecrans/systeme/**`) : un message explicite plutôt qu'une redirection muette
 * vers `/`, pour que l'utilisateur comprenne qu'il a été REFUSÉ, pas égaré. Réutilise
 * `erreurs:codes.DROIT_INSUFFISANT`, déjà traduit dans les trois langues et déjà servi par
 * l'API sur un `403` — même texte, deux origines (ici, avant même l'appel réseau).
 */
export function EcranAccesRefuse() {
  const { t } = useTranslation(['erreurs', 'commun']);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-sm space-y-4 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-lg font-semibold">{t('erreurs:codes.DROIT_INSUFFISANT')}</h1>
        <Button asChild variant="outline">
          <Link to="/">{t('commun:actions.retourAccueil')}</Link>
        </Button>
      </div>
    </div>
  );
}
