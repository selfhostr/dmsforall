import { Ban, CheckCircle2, Clock, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutConfirmationFinancement } from '@dfa/shared';

import { BadgeStatut } from '@/composants/identite/BadgeStatut';

type TokenStatut = 'attention' | 'succes' | 'danger';
type FormeBadge = 'plein' | 'contour';

interface EntreeStatutFinancement {
  readonly icone: LucideIcon;
  readonly token: TokenStatut;
  readonly forme: FormeBadge;
}

/** Mapping exhaustif et type-safe (même patron que `BadgeStatutReprise`) sur les 3 valeurs de
 *  `STATUTS_CONFIRMATION_FINANCEMENT` (@dfa/shared, gelé, CV-03). */
const CONFIG_STATUT_FINANCEMENT: Readonly<
  Record<StatutConfirmationFinancement, EntreeStatutFinancement>
> = {
  en_attente: { icone: Clock, token: 'attention', forme: 'plein' },
  confirme: { icone: CheckCircle2, token: 'succes', forme: 'plein' },
  // Contour, jamais plein — même doctrine que `BadgeStatutReprise.refusee` : un refus
  // d'organisme est un fait courant du parcours (CV-03), pas une erreur produit.
  refuse: { icone: Ban, token: 'danger', forme: 'contour' },
};

interface Props {
  readonly statut: StatutConfirmationFinancement;
  readonly className?: string;
}

/** Statut affiché d'un financement (`STATUTS_CONFIRMATION_FINANCEMENT`) — couleur + forme + icône
 *  + mot, jamais la couleur seule. */
export function BadgeStatutFinancement({ statut, className }: Props) {
  const { t } = useTranslation('ventes');
  const config = CONFIG_STATUT_FINANCEMENT[statut];
  const cle = statut === 'en_attente' ? 'enAttente' : statut;

  return (
    <BadgeStatut
      icone={config.icone}
      token={config.token}
      forme={config.forme}
      className={className}
    >
      {t(`ventes:financement.statuts.${cle}`)}
    </BadgeStatut>
  );
}
