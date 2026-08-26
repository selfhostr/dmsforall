import { AlertTriangle, Car, LogOut, Warehouse, type LucideIcon } from 'lucide-react';
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

/**
 * Icône par statut (DESIGN.md « Statuts » — forme + icône + mot obligatoires, jamais la couleur
 * seule ; dépôt pneus nommé explicitement). Défaut corrigé (refonte visuelle) : seul `a_relancer`
 * portait une icône, `en_depot`/`monte`/`sorti` ne s'appuyaient que sur la variante de couleur du
 * `Badge` — insuffisant en daltonisme. `Warehouse` (physiquement dans le hangar), `Car` (monté sur
 * le véhicule), `LogOut` (sorti du hangar), `AlertTriangle` (à relancer, déjà en place).
 */
const ICONE_PAR_STATUT: Record<StatutDepotPneus, LucideIcon> = {
  en_depot: Warehouse,
  monte: Car,
  a_relancer: AlertTriangle,
  sorti: LogOut,
};

export function BadgeStatutDepotPneu({ statut }: Props) {
  const { t } = useTranslation('pneus');
  const Icone = ICONE_PAR_STATUT[statut];

  return (
    <Badge variant={VARIANTE_PAR_STATUT[statut]} className="gap-1">
      <Icone className="h-3 w-3" aria-hidden="true" />
      {t(`pneus:statut.${statut}`)}
    </Badge>
  );
}
