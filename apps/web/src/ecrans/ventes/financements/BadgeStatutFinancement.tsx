import { Ban, CheckCircle2, Clock, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutConfirmationFinancement } from '@dfa/shared';

import { cn } from '@/lib/utils';

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

const CLASSES_PLEIN: Readonly<Record<TokenStatut, string>> = {
  attention: 'border-transparent bg-statut-attention-fond text-statut-attention',
  succes: 'border-transparent bg-statut-succes-fond text-statut-succes',
  danger: 'border-transparent bg-statut-danger-fond text-statut-danger',
};

const CLASSES_CONTOUR: Readonly<Record<TokenStatut, string>> = {
  attention: 'border-statut-attention bg-background text-statut-attention',
  succes: 'border-statut-succes bg-background text-statut-succes',
  danger: 'border-statut-danger bg-background text-statut-danger',
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
  const Icone = config.icone;
  const classesToken =
    config.forme === 'plein' ? CLASSES_PLEIN[config.token] : CLASSES_CONTOUR[config.token];

  const cle = statut === 'en_attente' ? 'enAttente' : statut;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 texte-libelle font-medium',
        classesToken,
        className,
      )}
    >
      <Icone aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {t(`ventes:financement.statuts.${cle}`)}
    </span>
  );
}
