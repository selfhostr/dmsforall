import { Ban, CheckCircle2, Clock, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutConfirmationFinancement } from '@dfa/shared';

import { cn } from '@/lib/utils';

/** Badge de statut du financement (`STATUTS_CONFIRMATION_FINANCEMENT`, `CV-03`) — même patron que
 *  `BadgeStatutReprise`. `refuse` reste ATTENTION (pas danger) : `CV-03` traite un refus comme un
 *  événement courant du parcours (le dossier attend une nouvelle proposition), pas une anomalie. */
type TokenStatut = 'attention' | 'succes';

const CONFIG: Readonly<
  Record<
    StatutConfirmationFinancement,
    { readonly cle: string; readonly icone: LucideIcon; readonly token: TokenStatut }
  >
> = {
  en_attente: { cle: 'enAttente', icone: Clock, token: 'attention' },
  confirme: { cle: 'confirme', icone: CheckCircle2, token: 'succes' },
  refuse: { cle: 'refuse', icone: Ban, token: 'attention' },
};

const CLASSES: Readonly<Record<TokenStatut, string>> = {
  attention: 'border-statut-attention bg-background text-statut-attention',
  succes: 'border-statut-succes bg-background text-statut-succes',
};

interface Props {
  readonly statut: StatutConfirmationFinancement;
  readonly className?: string;
}

export function BadgeStatutFinancement({ statut, className }: Props) {
  const { t } = useTranslation('ventes');
  const config = CONFIG[statut];
  const Icone = config.icone;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 texte-libelle font-medium',
        CLASSES[config.token],
        className,
      )}
    >
      <Icone aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {t(`ventes:financement.statuts.${config.cle}`)}
    </span>
  );
}
