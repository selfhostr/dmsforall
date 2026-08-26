import { CheckCircle2, XCircle, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutEnvoiRelance } from '@dfa/shared';

import { Badge, type BadgeProps } from '@/components/ui/badge';

interface EntreeStatutEnvoi {
  readonly icone: LucideIcon;
  readonly variant: NonNullable<BadgeProps['variant']>;
}

/**
 * Mapping exhaustif (sur le modèle de `composants/identite/BadgeStatutOr.tsx`) : ajouter une valeur
 * à `StatutEnvoiRelance` fait échouer `tsc` avant d'atteindre l'écran.
 *
 * DESIGN.md, refonte visuelle : « une relance "envoyée" confondue avec "planifiée" fait relancer un
 * client deux fois » — la trace d'envoi (`relance_envoi.statutEnvoi`, seul statut de ce domaine
 * réellement affiché à ce jour, voir `EcranRelances.tsx` §BlocTracabilite) portait jusqu'ici un
 * `<Badge>` coloré SEUL (`variant={envoi.statutEnvoi === 'envoye' ? 'default' : 'destructive'}`),
 * sans icône.
 *
 * VOLONTAIREMENT sur `<Badge>` générique (`components/ui/badge.tsx`), PAS sur `BadgeStatut`
 * (`composants/identite/`, famille des badges de statut d'OR) : DESIGN.md réserve les six jetons
 * `--statut-*` EXCLUSIVEMENT au statut d'un OR/d'une ligne d'OR, « jamais à une autre dimension »
 * — un statut d'envoi de relance en est une. `composants/identite/` est de toute façon hors
 * périmètre d'écriture de ce chantier. `variant="secondary"` (neutre) plutôt que `"default"`
 * (`bg-primary`, couleur de MARQUE) pour la même raison côté marque : un badge de statut ne
 * réutilise jamais la teinte de marque comme signal.
 */
const CONFIG_STATUT_ENVOI: Readonly<Record<StatutEnvoiRelance, EntreeStatutEnvoi>> = {
  envoye: { icone: CheckCircle2, variant: 'secondary' },
  echoue: { icone: XCircle, variant: 'destructive' },
};

interface Props {
  readonly statut: StatutEnvoiRelance;
  readonly className?: string;
}

export function BadgeStatutEnvoiRelance({ statut, className }: Props) {
  const { t } = useTranslation('relances');
  const config = CONFIG_STATUT_ENVOI[statut];
  const Icone = config.icone;

  return (
    <Badge variant={config.variant} className={className}>
      <Icone aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {t(`relances:tracabilite.statut.${statut}`)}
    </Badge>
  );
}
