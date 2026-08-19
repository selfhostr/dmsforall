import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

interface Props {
  readonly titre: string;
  readonly description: string;
  readonly onReessayer?: () => void;
}

/**
 * État d'erreur générique et actionnable (retry) pour une section/écran.
 *
 * REMBOURRAGE RELIÉ À LA DENSITÉ (19.08.2026, même correctif que `EtatVide.tsx`, voir sa doc de
 * tête pour la justification complète) — `p-10` fixe remplacé par `p-carte`/`gap-groupe`, tous
 * deux relus depuis l'ancêtre `.densite-*` le plus proche (défaut `aeree` en son absence).
 */
export function EtatErreur({ titre, description, onReessayer }: Props) {
  const { t } = useTranslation('commun');

  return (
    <div
      className="flex flex-col items-center gap-groupe rounded-lg border p-carte text-center"
      role="alert"
    >
      <h2 className="texte-titre-section">{titre}</h2>
      <p className="max-w-md text-muted-foreground">{description}</p>
      {onReessayer ? <Button onClick={onReessayer}>{t('commun:actions.reessayer')}</Button> : null}
    </div>
  );
}
