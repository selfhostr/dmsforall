import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface AutreSiteResume {
  readonly siteId: string;
  readonly nom: string;
  readonly total: number;
}

interface Props {
  /** Site dont l'agenda est affiché. */
  readonly siteId: string;
  /** Tous les sites choisissables : un seul = aucun sélecteur, aucune ligne (le site est évident). */
  readonly sites: readonly {
    readonly id: string;
    readonly nom: string;
    /** Étiquette compacte affichée dans le sélecteur (repli : `nom`). */
    readonly codeCourt?: string;
  }[];
  /** Rendez-vous des AUTRES sites sur la période affichée (0 = site sans rendez-vous, omis). */
  readonly autresSites: readonly AutreSiteResume[];
  readonly onChangerSite: (siteId: string) => void;
  /** Période sur laquelle `autresSites` a été compté : un jour (vue Jour) ou la semaine. */
  readonly portee?: 'jour' | 'semaine';
}

/**
 * Sélecteur de site compact (plusieurs sites seulement) et signalement des les rendez-vous qui existent ailleurs — sans
 * cela un rendez-vous pris à Martigny est invisible dans le planning de Sion, sans aucun indice.
 */
export function BandeauAutresSites({
  siteId,
  sites,
  autresSites,
  onChangerSite,
  portee = 'semaine',
}: Props) {
  const { t } = useTranslation('planning');
  // Un seul site : rien à choisir, rien à annoncer (et aucun « autre site » à compter).
  if (sites.length <= 1) return null;
  const avecRendezVous = autresSites.filter((s) => s.total > 0);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1" data-testid="bandeau-sites">
      {/* Sélecteur compact : la valeur affichée dit déjà « quel site » — pas de libellé au-dessus. */}
      <Select value={siteId} onValueChange={onChangerSite}>
        <SelectTrigger className="w-auto min-w-28" aria-label={t('planning:siteSelecteur')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sites.map((s) => (
            <SelectItem key={s.id} value={s.id} title={s.nom}>
              {s.codeCourt ?? s.nom}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {avecRendezVous.map((autre) => (
        <p key={autre.siteId} className="flex items-center gap-1 texte-corps text-muted-foreground">
          <span>
            {t(
              portee === 'jour'
                ? 'planning:autresSites.compteJour'
                : 'planning:autresSites.compteSemaine',
              {
                count: autre.total,
                site: autre.nom,
              },
            )}
          </span>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto min-h-11 px-1"
            onClick={() => onChangerSite(autre.siteId)}
          >
            {t('planning:autresSites.voir', { site: autre.nom })}
          </Button>
        </p>
      ))}
    </div>
  );
}
