import { Building2, User, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { TypeClient } from '@dfa/shared';

import { BadgeAttribut } from './BadgeAttribut';

/** Mapping exhaustif et type-safe : ajouter une valeur à `TYPES_CLIENT` fait échouer `tsc`. */
const ICONE_TYPE_CLIENT: Readonly<Record<TypeClient, LucideIcon>> = {
  particulier: User,
  entreprise: Building2,
};

interface Props {
  readonly type: TypeClient;
  readonly className?: string;
}

/** Type de client (particulier/entreprise, RM-01, **immuable après création**) — forme + mot,
 *  jamais de couleur de la palette statut (§5.4 du document atelier : le budget couleur est
 *  réservé au statut d'OR/de ligne). Compose `BadgeAttribut`, base partagée de la famille des
 *  badges d'attribut métier. */
export function BadgeTypeClient({ type, className }: Props) {
  const { t } = useTranslation('clients');
  const Icone = ICONE_TYPE_CLIENT[type];

  return (
    <BadgeAttribut
      icone={<Icone aria-hidden className="h-3.5 w-3.5 shrink-0" />}
      className={className}
    >
      {t(`clients:liste.types.${type}`)}
    </BadgeAttribut>
  );
}
