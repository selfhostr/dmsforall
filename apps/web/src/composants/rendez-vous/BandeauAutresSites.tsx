import { MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

export interface AutreSiteResume {
  readonly siteId: string;
  readonly nom: string;
  readonly total: number;
}

interface Props {
  /** Site dont l'agenda est affiché. */
  readonly siteNom: string;
  /** Rendez-vous des AUTRES sites sur la période affichée (0 = site sans rendez-vous, omis). */
  readonly autresSites: readonly AutreSiteResume[];
  readonly onChangerSite: (siteId: string) => void;
  /** Période sur laquelle `autresSites` a été compté : un jour (vue Jour) ou la semaine. */
  readonly portee?: 'jour' | 'semaine';
}

/**
 * Dit clairement quel site l'agenda montre, et signale les rendez-vous qui existent ailleurs — sans
 * cela un rendez-vous pris à Martigny est invisible dans le planning de Sion, sans aucun indice.
 */
export function BandeauAutresSites({
  siteNom,
  autresSites,
  onChangerSite,
  portee = 'semaine',
}: Props) {
  const { t } = useTranslation('planning');
  const avecRendezVous = autresSites.filter((s) => s.total > 0);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1" data-testid="bandeau-sites">
      <p className="flex items-center gap-1.5 texte-corps font-medium text-foreground">
        <MapPin aria-hidden className="h-4 w-4 text-muted-foreground" />
        {t('planning:siteAffiche', { site: siteNom })}
      </p>
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
