import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { GabaritEcran } from '@/composants/motifs/GabaritEcran';

export function EcranPageIntrouvable() {
  const { t } = useTranslation(['erreurs', 'commun']);

  return (
    // Route `*` (catch-all), HORS de l'arborescence de navigation (`routeur.tsx`) : aucun
    // libellé candidat pour la détection automatique du gabarit, le h1 reste donc VISIBLE par
    // défaut — mesuré, aucun `titreVisible` à poser ici, c'est le seul titre de l'écran.
    <GabaritEcran
      titre={t('erreurs:pageIntrouvable.titre')}
      className="min-h-dvh items-center justify-center p-6"
    >
      <div className="max-w-sm space-y-4 text-center">
        <p className="text-muted-foreground">{t('erreurs:pageIntrouvable.description')}</p>
        <Button asChild>
          <Link to="/">{t('commun:actions.retourAccueil')}</Link>
        </Button>
      </div>
    </GabaritEcran>
  );
}
