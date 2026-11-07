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

import { cn } from '@/lib/utils';

type Feu = 'neutre' | 'info' | 'attention' | 'succes' | 'danger' | 'terminal';

const CONFIG: Readonly<
  Partial<Record<StatutDocumentVente, { readonly icone: LucideIcon; readonly feu: Feu }>>
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

const CLASSES: Readonly<Record<Feu, string>> = {
  neutre: 'border-statut-neutre text-statut-neutre',
  info: 'border-statut-info text-statut-info',
  attention: 'border-statut-attention text-statut-attention',
  succes: 'border-statut-succes text-statut-succes',
  danger: 'border-statut-danger text-statut-danger',
  terminal: 'border-statut-terminal text-statut-terminal',
};

interface Props {
  readonly statut: StatutDocumentVente;
}

/** Statut d'un DEVIS (brouillon, envoyé, accepté…) : forme + icône + mot, jamais la couleur seule
 *  (DESIGN.md). Les statuts propres à une facture ont `BadgeEtatDocument`/`BadgeStatutReglement`. */
export function BadgeStatutDevis({ statut }: Props) {
  const { t } = useTranslation('facturation');
  const config = CONFIG[statut] ?? { icone: Ban, feu: 'neutre' as const };
  const Icone = config.icone;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-0.5 texte-libelle font-medium',
        CLASSES[config.feu],
      )}
    >
      <Icone aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {t(`facturation:devis.statuts.${statut}`)}
    </span>
  );
}
