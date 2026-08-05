import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutDepotPneus } from '@dfa/shared';

import { Badge, type BadgeProps } from '@/components/ui/badge';

interface Props {
  readonly statut: StatutDepotPneus;
}

const VARIANTE_PAR_STATUT: Record<StatutDepotPneus, NonNullable<BadgeProps['variant']>> = {
  en_depot: 'secondary',
  monte: 'default',
  a_relancer: 'destructive',
  sorti: 'outline',
};

/** Badge de statut (RPP-02/04/05) — `a_relancer` porte en plus une icône d'alerte : « place
 *  immobilisée et risque de litige » (spec §7), pas un statut neutre parmi d'autres. */
export function BadgeStatutDepotPneu({ statut }: Props) {
  const { t } = useTranslation('pneus');

  return (
    <Badge variant={VARIANTE_PAR_STATUT[statut]} className="gap-1">
      {statut === 'a_relancer' ? <AlertTriangle className="h-3 w-3" aria-hidden="true" /> : null}
      {t(`pneus:statut.${statut}`)}
    </Badge>
  );
}
