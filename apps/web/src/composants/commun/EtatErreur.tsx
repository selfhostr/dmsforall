import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

interface Props {
  readonly titre: string;
  readonly description: string;
  readonly onReessayer?: () => void;
}

/** État d'erreur générique et actionnable (retry) pour une section/écran. */
export function EtatErreur({ titre, description, onReessayer }: Props) {
  const { t } = useTranslation('commun');

  return (
    <div
      className="flex flex-col items-center gap-3 rounded-lg border p-10 text-center"
      role="alert"
    >
      <h2 className="text-lg font-semibold">{titre}</h2>
      <p className="max-w-md text-muted-foreground">{description}</p>
      {onReessayer ? <Button onClick={onReessayer}>{t('commun:actions.reessayer')}</Button> : null}
    </div>
  );
}
