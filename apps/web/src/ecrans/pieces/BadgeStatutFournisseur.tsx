import { CircleCheck, PowerOff, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutFournisseur } from '@dfa/shared';

import { BadgeStatut, type FormeBadge, type TokenStatut } from '@/composants/identite/BadgeStatut';

/**
 * Badge de statut d'un fournisseur (`STATUTS_FOURNISSEUR`) — même patron que
 * `BadgeStatutDossierVente` : forme + icône + mot, jamais la couleur seule. Remplace l'usage
 * direct de `<Badge variant={VARIANTE_BADGE_STATUT[...]}>` dans `EcranListeFournisseurs.tsx` et
 * `EcranFicheFournisseur.tsx` — interdit par l'en-tête de `components/ui/badge.tsx`.
 */
interface EntreeStatut {
  readonly icone: LucideIcon;
  readonly token: TokenStatut;
  readonly forme: FormeBadge;
}

const CONFIG_STATUT: Readonly<Record<StatutFournisseur, EntreeStatut>> = {
  actif: { icone: CircleCheck, token: 'succes', forme: 'plein' },
  // Contour, jamais plein — un fournisseur inactif est un fait administratif, pas une erreur.
  inactif: { icone: PowerOff, token: 'terminal', forme: 'contour' },
};

interface Props {
  readonly statut: StatutFournisseur;
  readonly className?: string;
}

export function BadgeStatutFournisseur({ statut, className }: Props) {
  const { t } = useTranslation('pieces');
  const config = CONFIG_STATUT[statut];

  return (
    <BadgeStatut
      icone={config.icone}
      token={config.token}
      forme={config.forme}
      className={className}
    >
      {t(`pieces:fournisseurs.statuts.${statut}`)}
    </BadgeStatut>
  );
}
