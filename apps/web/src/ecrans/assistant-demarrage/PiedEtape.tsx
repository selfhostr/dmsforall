import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

interface Props {
  readonly onRetour?: (() => void) | undefined;
  /** Absent : l'étape est obligatoire. */
  readonly onPasser?: (() => void) | undefined;
  readonly enCours?: boolean;
  /** Sans `submit`, le bouton principal appelle `onSuivant` (étape qui n'enregistre rien). */
  readonly submit?: boolean;
  readonly onSuivant?: (() => void) | undefined;
  readonly libelleSuivant?: string | undefined;
  readonly desactiveSuivant?: boolean;
}

/** Pied commun : Retour, Passer, puis l'action principale (la plus à droite). */
export function PiedEtape({
  onRetour,
  onPasser,
  enCours = false,
  submit = true,
  onSuivant,
  libelleSuivant,
  desactiveSuivant = false,
}: Props) {
  const { t } = useTranslation('assistant');
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      <div className="flex flex-wrap gap-2">
        {onRetour ? (
          <Button type="button" variant="outline" onClick={onRetour} disabled={enCours}>
            {t('assistant:actions.retour')}
          </Button>
        ) : null}
        {onPasser ? (
          <Button type="button" variant="ghost" onClick={onPasser} disabled={enCours}>
            {t('assistant:actions.passer')}
          </Button>
        ) : null}
      </div>
      <Button
        type={submit ? 'submit' : 'button'}
        onClick={submit ? undefined : onSuivant}
        disabled={enCours || desactiveSuivant}
      >
        {enCours
          ? t('assistant:actions.enregistrement')
          : (libelleSuivant ?? t('assistant:actions.enregistrerContinuer'))}
      </Button>
    </div>
  );
}
