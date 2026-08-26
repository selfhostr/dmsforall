import { Ban, CheckCircle2, Circle, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutTravailReporte } from '@dfa/shared';

import { BadgeAttribut } from '@/composants/identite/BadgeAttribut';

interface EntreeStatutTravailReporte {
  readonly icone: LucideIcon;
  /** `true` -> texte accentué (gras + `text-foreground`), même doctrine que `BadgeStatutClient`
   *  (`bloque`) : réservé au seul statut qui clôt sans suite favorable (`abandonne`, refus client).
   *  Jamais un token `--statut-*` : un travail reporté n'est ni un OR ni une ligne d'OR (DESIGN.md,
   *  §« Statuts d'OR » — budget couleur réservé à ce seul domaine). */
  readonly accentue: boolean;
}

/** Mapping exhaustif et type-safe (même patron que `BadgeStatutClient`,
 *  `composants/identite/`) : ajouter un statut à `STATUTS_TRAVAIL_REPORTE` fait échouer `tsc` ici
 *  avant d'atteindre l'écran. */
const CONFIG_STATUT_TRAVAIL_REPORTE: Readonly<
  Record<StatutTravailReporte, EntreeStatutTravailReporte>
> = {
  ouvert: { icone: Circle, accentue: false },
  repris: { icone: CheckCircle2, accentue: false },
  abandonne: { icone: Ban, accentue: true },
};

interface Props {
  readonly statut: StatutTravailReporte;
  readonly className?: string;
}

/**
 * DÉFAUT CORRIGÉ (audit refonte visuelle, DESIGN.md « forme + icône + mot obligatoires, jamais la
 * couleur seule ») — `PanneauTravauxReportes.tsx` affichait ce statut via un `<Badge
 * variant="outline">` texte seul, sans icône : `repris` et `abandonne` ne se distinguaient que par
 * le mot lui-même, aucune forme/icône de renfort. Même composition que `BadgeStatutClient`
 * (`BadgeAttribut`, jamais un token `--statut-*`) plutôt que `BadgeStatut`/`TokenStatut` : un
 * travail reporté n'est pas un statut d'OR.
 */
export function BadgeStatutTravailReporte({ statut, className }: Props) {
  const { t } = useTranslation('vehicules');
  const config = CONFIG_STATUT_TRAVAIL_REPORTE[statut];
  const Icone = config.icone;

  return (
    <BadgeAttribut
      icone={<Icone aria-hidden className="h-3.5 w-3.5 shrink-0" />}
      accentue={config.accentue}
      className={className}
    >
      {t(`vehicules:travauxReportes.statuts.${statut}`)}
    </BadgeAttribut>
  );
}
