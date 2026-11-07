import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Circle, Lock, Play, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  BadgeStatut,
  type FormeBadge,
  type TokenStatut,
} from '@/composants/identite/BadgeStatut';

type StatutPointage = 'en_cours' | 'termine' | 'valide' | 'verrouille';

const CONFIG_STATUT: Readonly<
  Record<StatutPointage, { icone: LucideIcon; token: TokenStatut; forme: FormeBadge }>
> = {
  en_cours: { icone: Play, token: 'info', forme: 'plein' },
  termine: { icone: Circle, token: 'neutre', forme: 'contour' },
  valide: { icone: CheckCircle2, token: 'succes', forme: 'plein' },
  verrouille: { icone: Lock, token: 'terminal', forme: 'contour' },
};

/** Statut d'un pointage : forme + icône + mot (jamais la couleur seule). */
export function BadgeStatutPointage({ statut }: { readonly statut: StatutPointage }) {
  const { t } = useTranslation('pointage');
  const { icone, token, forme } = CONFIG_STATUT[statut];
  return (
    <BadgeStatut icone={icone} token={token} forme={forme}>
      {t(`pointage:statuts.${statut}`)}
    </BadgeStatut>
  );
}

/** Anomalie de pointage : danger plein + icône. `children` = mot ou compte déjà traduit. */
export function BadgeAnomaliePointage({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <BadgeStatut icone={AlertTriangle} token="danger" forme="plein" className={className}>
      {children}
    </BadgeStatut>
  );
}

/** Technicien en cours de pointage. */
export function BadgeEnCoursPointage({ className }: { readonly className?: string }) {
  const { t } = useTranslation('pointage');
  return (
    <BadgeStatut icone={Play} token="info" forme="plein" className={className}>
      {t('pointage:jour.enCoursBadge')}
    </BadgeStatut>
  );
}
