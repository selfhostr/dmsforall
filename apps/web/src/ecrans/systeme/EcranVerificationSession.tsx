import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const DELAI_SPINNER_MS = 200;

/** Rendu par RouteProtegee ET RoutePublique pendant `isPending` — c'est la garantie anti-flash
 *  (jamais un flash de l'écran de login avant de savoir si une session existe déjà). Le
 *  spinner est différé de 200ms : sur une vérification rapide, l'écran reste silencieux
 *  plutôt que de clignoter. */
export function EcranVerificationSession() {
  const { t } = useTranslation('auth');
  const [afficherSpinner, setAfficherSpinner] = useState(false);

  useEffect(() => {
    const identifiant = window.setTimeout(() => setAfficherSpinner(true), DELAI_SPINNER_MS);
    return () => window.clearTimeout(identifiant);
  }, []);

  return (
    <div className="flex min-h-dvh items-center justify-center" role="status" aria-live="polite">
      {afficherSpinner ? (
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <span
            className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
          <p>{t('auth:session.verification')}</p>
        </div>
      ) : (
        <span className="sr-only">{t('auth:session.verification')}</span>
      )}
    </div>
  );
}
