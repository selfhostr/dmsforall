import {
  ArrowRightCircle,
  Ban,
  CheckCircle2,
  Clock,
  PencilLine,
  Send,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutDocumentVente } from '@dfa/shared';

import { BadgeStatut } from '@/composants/identite/BadgeStatut';
import type { TokenStatut } from '@/composants/identite/BadgeStatut';

const CONFIG: Readonly<
  Partial<Record<StatutDocumentVente, { readonly icone: LucideIcon; readonly feu: TokenStatut }>>
> = {
  brouillon: { icone: PencilLine, feu: 'neutre' },
  emis: { icone: Send, feu: 'info' },
  accepte: { icone: CheckCircle2, feu: 'succes' },
  refuse: { icone: XCircle, feu: 'danger' },
  expire: { icone: Clock, feu: 'attention' },
  transforme: { icone: ArrowRightCircle, feu: 'terminal' },
  remplace: { icone: Ban, feu: 'neutre' },
  annule: { icone: Ban, feu: 'neutre' },
  abandonne: { icone: Ban, feu: 'neutre' },
};

interface Props {
  readonly statut: StatutDocumentVente;
}

/** Statut d'un DEVIS (brouillon, envoyé, accepté…) : forme + icône + mot, jamais la couleur seule
 *  (DESIGN.md). Les statuts propres à une facture ont `BadgeEtatDocument`/`BadgeStatutReglement`. */
export function BadgeStatutDevis({ statut }: Props) {
  const { t } = useTranslation('facturation');
  const config = CONFIG[statut] ?? { icone: Ban, feu: 'neutre' as const };
  return (
    <BadgeStatut icone={config.icone} token={config.feu} forme="contour">
      {t(`facturation:devis.statuts.${statut}`)}
    </BadgeStatut>
  );
}
