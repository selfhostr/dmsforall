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
 * premier rendu, le serveur applique alors son défaut (mois civil courant). Partagé par les DEUX
 * blocs (activité, financier) : une seule paire de sélecteurs en haut de l'écran, pas un par bloc
 * (voir `EcranTableauBord.tsx`).
 *
 * AUCUN bouton « Appliquer » — DÉCISION EXPLICITE (test manuel du 14.08.2026, défaut #3 : le
 * testeur n'a trouvé aucun moyen d'appliquer `du`/`au`, faute de savoir que c'était déjà fait).
 * `DateInput.onChange` (`components/ui/date-input.tsx`) ne remonte une valeur qu'une fois la date
 * COMPLÈTE et valide tapée — dès cet instant, `du`/`au` changent, la clé TanStack Query
 * (`clesTableauBord.financier`, qui contient le filtre COMPLET) change avec eux, et la requête
 * repart AUTOMATIQUEMENT. Un bouton serait un second mécanisme redondant avec celui qui existe
 * déjà (plus de surface à tester, sans rien changer au comportement) — ce qui manquait n'était pas
 * une commande, c'était de RENDRE VISIBLE que la saisie suffit : `periode.appliqueeAutomatiquement`
 * ci-dessous le dit explicitement, à côté des champs, plutôt que de laisser deviner.
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
    <div className="flex flex-col gap-1.5">
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
          <p className="pb-2.5 texte-libelle text-muted-foreground">
            {t('tableauBord:periode.periodeAffichee', {
              du: formaterDate(periodeAppliquee.du),
              au: formaterDate(periodeAppliquee.au),
            })}
          </p>
        ) : null}
      </div>
      <p className="texte-libelle text-muted-foreground">
        {t('tableauBord:periode.appliqueeAutomatiquement')}
      </p>
    </div>
  );
}
