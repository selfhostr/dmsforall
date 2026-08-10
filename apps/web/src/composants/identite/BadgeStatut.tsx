import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * Squelette partagé des badges de statut métier — forme + icône + mot, JAMAIS la couleur seule
 * (vérification daltonisme : `--statut-info`/`--statut-succes` restent séparables en protanopie
 * grâce à la forme et à l'icône, pas à la seule teinte). `icone` et `children` sont des props
 * obligatoires précisément pour ça : impossible de composer un badge de statut avec la couleur
 * pour seul signal.
 *
 * Consommé par `BadgeStatutOr`, `BadgeStatutDossierVente` (`ecrans/ventes/dossiers/`) et
 * `BadgeStatutVehiculeStock` (`ecrans/ventes/stock/`) — trois copies verbatim de ce rendu et des
 * classes `CLASSES_PLEIN`/`CLASSES_CONTOUR` avant leur factorisation ici. Chaque domaine garde en
 * propre son mapping enum -> `{ icone, token, forme }` (`CONFIG_STATUT*`) : c'est de la logique
 * métier qui diffère réellement d'un domaine à l'autre, pas de la duplication.
 */
export type TokenStatut = 'neutre' | 'info' | 'attention' | 'succes' | 'terminal' | 'danger';
export type FormeBadge = 'plein' | 'contour';

export const CLASSES_PLEIN: Readonly<Record<TokenStatut, string>> = {
  neutre: 'border-transparent bg-statut-neutre-fond text-statut-neutre',
  info: 'border-transparent bg-statut-info-fond text-statut-info',
  attention: 'border-transparent bg-statut-attention-fond text-statut-attention',
  succes: 'border-transparent bg-statut-succes-fond text-statut-succes',
  terminal: 'border-transparent bg-statut-terminal-fond text-statut-terminal',
  danger: 'border-transparent bg-statut-danger-fond text-statut-danger',
};

export const CLASSES_CONTOUR: Readonly<Record<TokenStatut, string>> = {
  neutre: 'border-statut-neutre bg-background text-statut-neutre',
  info: 'border-statut-info bg-background text-statut-info',
  attention: 'border-statut-attention bg-background text-statut-attention',
  succes: 'border-statut-succes bg-background text-statut-succes',
  terminal: 'border-statut-terminal bg-background text-statut-terminal',
  danger: 'border-statut-danger bg-background text-statut-danger',
};

interface Props {
  readonly icone: LucideIcon;
  readonly token: TokenStatut;
  readonly forme: FormeBadge;
  readonly className?: string;
  readonly children: ReactNode;
}

/** Rendu commun d'un badge de statut : icône + mot traduit, classes dérivées de `token`/`forme`.
 *  Chaque badge de statut du produit compose celui-ci avec son propre mapping métier plutôt que
 *  de recopier ce JSX et ces classes Tailwind. */
export function BadgeStatut({ icone: Icone, token, forme, className, children }: Props) {
  const classesToken = forme === 'plein' ? CLASSES_PLEIN[token] : CLASSES_CONTOUR[token];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 texte-libelle font-medium',
        classesToken,
        className,
      )}
    >
      <Icone aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {children}
    </span>
  );
}
