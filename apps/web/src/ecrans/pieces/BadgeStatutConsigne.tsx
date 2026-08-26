import { Circle, Clock, PackageCheck, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutConsigneEchangeStandard } from '@dfa/shared';

import { BadgeStatut, type FormeBadge, type TokenStatut } from '@/composants/identite/BadgeStatut';

/**
 * Badge de statut d'une consigne d'échange standard (`STATUTS_CONSIGNE_ECHANGE_STANDARD`, GELÉ —
 * engage la chaîne financière RF-100, §6.4) — même patron que `BadgeStatutFinancement` : forme +
 * icône + mot, jamais la couleur seule. Remplace l'usage direct de
 * `<Badge variant={VARIANTE_BADGE_STATUT[...]}>` dans `EcranConsignesPieces.tsx` — interdit par
 * l'en-tête de `components/ui/badge.tsx`.
 */
interface EntreeStatut {
  readonly icone: LucideIcon;
  readonly token: TokenStatut;
  readonly forme: FormeBadge;
}

const CONFIG_STATUT: Readonly<Record<StatutConsigneEchangeStandard, EntreeStatut>> = {
  // `deposee_par_client` : contour neutre, comme `BadgeStatutReprise.estimee` — état théorique du
  // diagramme §6.4, atteint par aucune action exposée aujourd'hui (voir le commentaire de
  // `STATUTS_CONSIGNE_ECHANGE_STANDARD`, `contrats/pieces/enums.ts`).
  deposee_par_client: { icone: Circle, token: 'neutre', forme: 'contour' },
  en_attente_retour_fournisseur: { icone: Clock, token: 'attention', forme: 'plein' },
  retournee_fournisseur: { icone: PackageCheck, token: 'succes', forme: 'plein' },
};

interface Props {
  readonly statut: StatutConsigneEchangeStandard;
  readonly className?: string;
}

export function BadgeStatutConsigne({ statut, className }: Props) {
  const { t } = useTranslation('pieces');
  const config = CONFIG_STATUT[statut];

  return (
    <BadgeStatut
      icone={config.icone}
      token={config.token}
      forme={config.forme}
      className={className}
    >
      {t(`pieces:consignes.statuts.${statut}`)}
    </BadgeStatut>
  );
}
