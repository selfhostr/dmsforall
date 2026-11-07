import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

import { useQuitterAssistant } from './contexte-quitter';

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

/** Pied commun, une seule rangée : Retour et Passer à gauche ; « Quitter pour l'instant » puis
 *  l'action principale (la plus à droite) à droite. */
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
  const onQuitter = useQuitterAssistant();
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
      <div className="flex flex-wrap items-center gap-2">
        {onQuitter ? (
          <Button type="button" variant="ghost" onClick={onQuitter} disabled={enCours}>
            {t('assistant:actions.quitter')}
          </Button>
        ) : null}
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
    </div>
  );
}

/** Pied réduit à « Quitter pour l'instant » : affiché pendant le chargement ou après une erreur
 *  d'une étape, quand aucune action principale n'est encore possible — l'assistant ne doit jamais
 *  enfermer l'utilisateur. Absent hors de l'assistant (pas de contexte de fermeture). */
export function PiedQuitterSeul() {
  const { t } = useTranslation('assistant');
  const onQuitter = useQuitterAssistant();
  if (!onQuitter) return null;
  return (
    <div className="flex items-center justify-end gap-3 border-t pt-4">
      <Button type="button" variant="ghost" onClick={onQuitter}>
        {t('assistant:actions.quitter')}
      </Button>
    </div>
  );
}
