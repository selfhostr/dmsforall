import { useTranslation } from 'react-i18next';

import type { ErreurEnvInvalide } from '@/config/env';

interface Props {
  readonly erreur?: ErreurEnvInvalide;
}

/** Rendu AVANT même le montage du reste de l'app quand `chargerEnv()` échoue — ni QueryClient
 *  ni routeur ne sont montés à ce stade. i18n est en revanche déjà initialisé (il ne dépend
 *  d'aucune variable `VITE_*`), donc pas de chaîne en dur ici non plus. Le détail des
 *  variables fautives n'est volontairement pas affiché à l'écran (public de garagistes, pas
 *  d'informaticiens) : il part en console pour le support/l'intégrateur.
 *
 *  EXCEPTION DÉLIBÉRÉE au chantier « titres doublés & espacements » (17.08.2026), même raison
 *  que `EcranErreurFatale` — en PIRE : `main.tsx` appelle `racine.render(<EcranConfigInvalide/>)`
 *  directement, sans `<App/>`, donc sans JAMAIS avoir monté `<RouterProvider>`. `GabaritEcran`
 *  a besoin d'un hook React Router pour situer la route courante (§3 du contrat) ; l'utiliser ici
 *  romprait ce garde-fou de démarrage. Gardé en h1 manuel, visible, sans dépendance — même
 *  signalement au socle que sur `EcranErreurFatale`. */
export function EcranConfigInvalide({ erreur }: Props) {
  const { t } = useTranslation('erreurs');

  if (erreur) {
    // Diagnostic volontaire pour l'intégrateur, jamais affiché à l'écran (`console.error` est
    // explicitement autorisé par la configuration ESLint du dépôt, règle `no-console`).
    console.error('Configuration frontend invalide :', erreur.problemes);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-sm space-y-4 text-center">
        <h1 className="texte-titre-page">{t('erreurs:configuration.titre')}</h1>
        <p className="text-muted-foreground">{t('erreurs:configuration.description')}</p>
      </div>
    </div>
  );
}
