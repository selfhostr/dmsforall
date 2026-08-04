import { Ban, CheckCircle2, Circle, Handshake, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutReprise } from '@dfa/shared';

import { cn } from '@/lib/utils';

type TokenStatut = 'neutre' | 'info' | 'succes' | 'danger';
type FormeBadge = 'plein' | 'contour';

interface EntreeStatutReprise {
  readonly icone: LucideIcon;
  readonly token: TokenStatut;
  readonly forme: FormeBadge;
}

/**
 * Mapping exhaustif et type-safe (même patron que `composants/identite/BadgeStatutOr.tsx`) : une
 * cinquième valeur ajoutée à `STATUTS_REPRISE` (@dfa/shared, gelé — improbable, mais le filet
 * reste correct) fait échouer `tsc` avant d'atteindre un écran.
 *
 * `refusee` en token `danger`/CONTOUR (jamais plein) — §3.5/§8.4 du design : un badge rouge sur
 * une reprise refusée ne doit pas lire comme une erreur du produit, juste comme un fait (le mot
 * « Refusée » suffit à désambiguïser, la couleur seule ne porte jamais le sens).
 */
const CONFIG_STATUT_REPRISE: Readonly<Record<StatutReprise, EntreeStatutReprise>> = {
  estimee: { icone: Circle, token: 'neutre', forme: 'contour' },
  negociee: { icone: Handshake, token: 'info', forme: 'plein' },
  confirmee: { icone: CheckCircle2, token: 'succes', forme: 'plein' },
  refusee: { icone: Ban, token: 'danger', forme: 'contour' },
};

const CLASSES_PLEIN: Readonly<Record<TokenStatut, string>> = {
  neutre: 'border-transparent bg-statut-neutre text-white',
  info: 'border-transparent bg-statut-info text-white',
  succes: 'border-transparent bg-statut-succes text-white',
  danger: 'border-transparent bg-statut-danger text-white',
};

const CLASSES_CONTOUR: Readonly<Record<TokenStatut, string>> = {
  neutre: 'border-statut-neutre bg-background text-statut-neutre',
  info: 'border-statut-info bg-background text-statut-info',
  succes: 'border-statut-succes bg-background text-statut-succes',
  danger: 'border-statut-danger bg-background text-statut-danger',
};

interface Props {
  readonly statut: StatutReprise;
  readonly className?: string;
}

/** Statut affiché d'une reprise (`STATUTS_REPRISE`, `contrats/ventes/enums.ts`) — couleur + forme
 *  + icône + mot, jamais la couleur seule (doctrine daltonisme, `BadgeStatutOr`). */
export function BadgeStatutReprise({ statut, className }: Props) {
  const { t } = useTranslation('ventes');
  const config = CONFIG_STATUT_REPRISE[statut];
  const Icone = config.icone;
  const classesToken =
    config.forme === 'plein' ? CLASSES_PLEIN[config.token] : CLASSES_CONTOUR[config.token];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 texte-libelle font-medium',
        classesToken,
        className,
      )}
    >
      <Icone aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {t(`ventes:reprise.statuts.${statut}`)}
    </span>
  );
}
