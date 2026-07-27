import { useTranslation } from 'react-i18next';

import type { ErreurEnvInvalide } from '@/config/env';

interface Props {
  readonly erreur?: ErreurEnvInvalide;
}

/** Rendu AVANT même le montage du reste de l'app quand `chargerEnv()` échoue — ni QueryClient
 *  ni routeur ne sont montés à ce stade. i18n est en revanche déjà initialisé (il ne dépend
 *  d'aucune variable `VITE_*`), donc pas de chaîne en dur ici non plus. Le détail des
 *  variables fautives n'est volontairement pas affiché à l'écran (public de garagistes, pas
 *  d'informaticiens) : il part en console pour le support/l'intégrateur. */
export function EcranConfigInvalide({ erreur }: Props) {
  const { t } = useTranslation('erreurs');

  if (erreur) {
    // eslint-disable-next-line no-console -- diagnostic volontaire pour l'intégrateur, jamais affiché à l'écran
    console.error('Configuration frontend invalide :', erreur.problemes);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-sm space-y-4 text-center">
        <h1 className="text-lg font-semibold">{t('erreurs:configuration.titre')}</h1>
        <p className="text-muted-foreground">{t('erreurs:configuration.description')}</p>
      </div>
    </div>
  );
}
