import { CheckCircle2, XCircle, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutEnvoiRelance } from '@dfa/shared';

import { BadgeStatut } from '@/composants/identite/BadgeStatut';
import type { FormeBadge, TokenStatut } from '@/composants/identite/BadgeStatut';

interface EntreeStatutEnvoi {
  readonly icone: LucideIcon;
  readonly token: TokenStatut;
  readonly forme: FormeBadge;
}

/**
 * Mapping exhaustif : ajouter une valeur à `StatutEnvoiRelance` fait échouer `tsc` avant d'atteindre
 * l'écran. Badge de statut standard (`BadgeStatut`) : forme + icône + mot, jamais la couleur seule.
 * Un échec d'envoi est plein (signal à traiter), un envoi réussi en contour.
 */
const CONFIG_STATUT_ENVOI: Readonly<Record<StatutEnvoiRelance, EntreeStatutEnvoi>> = {
  envoye: { icone: CheckCircle2, token: 'succes', forme: 'contour' },
  echoue: { icone: XCircle, token: 'danger', forme: 'plein' },
};

interface Props {
  readonly statut: StatutEnvoiRelance;
  readonly className?: string;
}

export function BadgeStatutEnvoiRelance({ statut, className }: Props) {
  const { t } = useTranslation('relances');
  const config = CONFIG_STATUT_ENVOI[statut];

  return (
    <BadgeStatut
      icone={config.icone}
      token={config.token}
      forme={config.forme}
      className={className}
    >
      {t(`relances:tracabilite.statut.${statut}`)}
    </BadgeStatut>
  );
}
