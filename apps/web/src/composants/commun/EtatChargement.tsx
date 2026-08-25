import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/ui/skeleton';

interface Props {
  readonly lignes?: number;
}

/** Squelette de chargement générique pour un écran/section en attente de données serveur. */
export function EtatChargement({ lignes = 3 }: Props) {
  const { t } = useTranslation('commun');

  return (
    <div className="space-y-groupe" role="status" aria-live="polite">
      <span className="sr-only">{t('commun:chargement.enCours')}</span>
      {Array.from({ length: lignes }, (_, index) => (
        <Skeleton key={index} className="h-11 w-full" aria-hidden="true" />
      ))}
    </div>
  );
}
