import { AlertTriangle, CheckCircle2, XCircle, type LucideIcon } from 'lucide-react';
import type { NiveauSanteGarage } from '@dfa/shared';
import { useTranslation } from 'react-i18next';

import { BadgeStatut } from '@/composants/identite/BadgeStatut';
import type { FormeBadge, TokenStatut } from '@/composants/identite/BadgeStatut';

interface EntreeStatutGarage {
  readonly icone: LucideIcon;
  readonly token: TokenStatut;
  readonly forme: FormeBadge;
}

/**
 * Mapping exhaustif et type-safe (même patron que `BadgeStatutOr`/`BadgeStatutClient`,
 * `composants/identite/`) : ajouter une valeur à `NiveauSanteGarage` (`@dfa/shared`) fait échouer
 * `tsc` avant d'atteindre l'écran. Couleur ET forme distinctes pour les trois états — jamais la
 * couleur seule :
 *  - `critique` : plein rouge, `XCircle` — bloque un geste métier chez le garage, là, maintenant.
 *  - `attention` : plein ambre, `AlertTriangle` — à surveiller, pas encore bloquant.
 *  - `ok` : contour neutre, `CheckCircle2` — délibérément discret, ce n'est pas l'état qu'on
 *    scanne en premier (§0 de la conception : on cherche l'anomalie, pas la normalité).
 */
const CONFIG_STATUT_GARAGE: Readonly<Record<NiveauSanteGarage, EntreeStatutGarage>> = {
  critique: {
    icone: XCircle,
    token: 'danger',
    forme: 'plein',
  },
  attention: {
    icone: AlertTriangle,
    token: 'attention',
    forme: 'plein',
  },
  ok: {
    icone: CheckCircle2,
    token: 'neutre',
    forme: 'contour',
  },
};

interface Props {
  readonly statut: NiveauSanteGarage;
  readonly className?: string;
}

export function BadgeStatutGarage({ statut, className }: Props) {
  const { t } = useTranslation('console');
  const { icone: Icone, token, forme } = CONFIG_STATUT_GARAGE[statut];

  return (
    <BadgeStatut icone={Icone} token={token} forme={forme} className={className}>
      {t(`console:plateforme.statut.${statut}`)}
    </BadgeStatut>
  );
}
