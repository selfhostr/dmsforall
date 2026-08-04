import { Ban, CheckCircle2, FileText, Handshake, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutReprise } from '@dfa/shared';

import { cn } from '@/lib/utils';

/** Badge de statut de la reprise (`STATUTS_REPRISE`, §6.3, machine à états GELÉE) — même patron
 *  que `BadgeStatutDossierVente`. `refusee` reste un token NEUTRE/ATTENTION, jamais `danger` : le
 *  refus d'une reprise est une issue normale du processus (RV-25, design §8.4), pas une anomalie. */
type TokenStatut = 'neutre' | 'info' | 'attention' | 'succes';

const CONFIG: Readonly<
  Record<
    StatutReprise,
    { readonly cle: string; readonly icone: LucideIcon; readonly token: TokenStatut }
  >
> = {
  estimee: { cle: 'estimee', icone: FileText, token: 'neutre' },
  negociee: { cle: 'negociee', icone: Handshake, token: 'info' },
  confirmee: { cle: 'confirmee', icone: CheckCircle2, token: 'succes' },
  refusee: { cle: 'refusee', icone: Ban, token: 'attention' },
};

const CLASSES: Readonly<Record<TokenStatut, string>> = {
  neutre: 'border-statut-neutre bg-background text-statut-neutre',
  info: 'border-statut-info bg-background text-statut-info',
  attention: 'border-statut-attention bg-background text-statut-attention',
  succes: 'border-statut-succes bg-background text-statut-succes',
};

interface Props {
  readonly statut: StatutReprise;
  readonly className?: string;
}

export function BadgeStatutReprise({ statut, className }: Props) {
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
      {t(`ventes:reprise.statuts.${config.cle}`)}
    </span>
  );
}
