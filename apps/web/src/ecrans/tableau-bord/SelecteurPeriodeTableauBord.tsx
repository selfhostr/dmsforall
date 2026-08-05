import { useTranslation } from 'react-i18next';

import type { PeriodeResolueTableauBord } from '@dfa/shared';

import { DateInput } from '@/components/ui/date-input';
import { Label } from '@/components/ui/label';
import { formaterDate } from '@/lib/formats';

interface Props {
  readonly du: string | undefined;
  readonly au: string | undefined;
  readonly onChangeDu: (iso: string | undefined) => void;
  readonly onChangeAu: (iso: string | undefined) => void;
  /** Période EFFECTIVEMENT appliquée par le serveur (`reponse.periode`, toujours renvoyée en
   *  écho) — affichée à côté des champs pour qu'un utilisateur qui n'a rien saisi comprenne quelle
   *  période il regarde (le mois civil courant, par défaut serveur). `undefined` tant qu'aucune
   *  réponse n'est encore arrivée. */
  readonly periodeAppliquee: PeriodeResolueTableauBord | undefined;
}

/**
 * Deux champs de date (`du`/`au`), état local initialement `undefined` — aucune valeur envoyée au
 * premier rendu, le serveur applique alors son défaut (mois civil UTC courant). Partagé par les
 * DEUX blocs (activité, financier) : une seule paire de sélecteurs en haut de l'écran, pas un par
 * bloc (voir `EcranTableauBord.tsx`).
 */
export function SelecteurPeriodeTableauBord({
  du,
  au,
  onChangeDu,
  onChangeAu,
  periodeAppliquee,
}: Props) {
  const { t } = useTranslation('tableauBord');

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tableau-bord-periode-du">{t('tableauBord:periode.du')}</Label>
        <DateInput
          id="tableau-bord-periode-du"
          value={du ?? null}
          onChange={onChangeDu}
          className="w-40"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tableau-bord-periode-au">{t('tableauBord:periode.au')}</Label>
        <DateInput
          id="tableau-bord-periode-au"
          value={au ?? null}
          onChange={onChangeAu}
          className="w-40"
        />
      </div>
      {periodeAppliquee ? (
        <p className="pb-2.5 text-sm text-muted-foreground">
          {t('tableauBord:periode.periodeAffichee', {
            du: formaterDate(periodeAppliquee.du),
            au: formaterDate(periodeAppliquee.au),
          })}
        </p>
      ) : null}
    </div>
  );
}
