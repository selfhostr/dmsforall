import { Bookmark, CircleCheck, Unlock, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutReservationPiece } from '@dfa/shared';

import { BadgeStatut, type FormeBadge, type TokenStatut } from '@/composants/identite/BadgeStatut';

/**
 * Badge de statut d'une réservation de pièce (`STATUTS_RESERVATION_PIECE`, GELÉ, §6.3 — arbitre
 * `CP-02`) — même patron que `BadgeStatutDossierVente` : forme + icône + mot, jamais la couleur
 * seule. Remplace l'usage direct de `<Badge variant={VARIANTE_BADGE_STATUT[...]}>` dans
 * `EcranReservationsPieces.tsx` — interdit par l'en-tête de `components/ui/badge.tsx`.
 */
interface EntreeStatut {
  readonly icone: LucideIcon;
  readonly token: TokenStatut;
  readonly forme: FormeBadge;
}

const CONFIG_STATUT: Readonly<Record<StatutReservationPiece, EntreeStatut>> = {
  active: { icone: Bookmark, token: 'info', forme: 'plein' },
  satisfaite: { icone: CircleCheck, token: 'succes', forme: 'plein' },
  // Contour, jamais plein — une réservation libérée est un fait courant (annulation, refus de
  // devis…), pas une erreur produit ; même doctrine que `BadgeStatutReprise.refusee`.
  liberee: { icone: Unlock, token: 'neutre', forme: 'contour' },
};

interface Props {
  readonly statut: StatutReservationPiece;
  readonly className?: string;
}

export function BadgeStatutReservationPiece({ statut, className }: Props) {
  const { t } = useTranslation('pieces');
  const config = CONFIG_STATUT[statut];

  return (
    <BadgeStatut
      icone={config.icone}
      token={config.token}
      forme={config.forme}
      className={className}
    >
      {t(`pieces:reservations.statuts.${statut}`)}
    </BadgeStatut>
  );
}
