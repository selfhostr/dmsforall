import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';

export function EcranPageIntrouvable() {
  const { t } = useTranslation(['erreurs', 'commun']);

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="max-w-sm space-y-4 text-center">
        <h1 className="text-lg font-semibold">{t('erreurs:pageIntrouvable.titre')}</h1>
        <p className="text-muted-foreground">{t('erreurs:pageIntrouvable.description')}</p>
        <Button asChild>
          <Link to="/">{t('commun:actions.retourAccueil')}</Link>
        </Button>
      </div>
    </div>
  );
}
