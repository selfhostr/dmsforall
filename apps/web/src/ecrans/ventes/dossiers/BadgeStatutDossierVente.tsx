import {
  Ban,
  FileCheck,
  KeyRound,
  Lock,
  PackageCheck,
  Search,
  UserX,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutDossierVente } from '@dfa/shared';

import { cn } from '@/lib/utils';

/**
 * Badge de statut du dossier de vente (`STATUTS_DOSSIER_VENTE`, §6.2, machine à états GELÉE) —
 * même patron que `BadgeStatutOr` (étape 1) : forme + icône + mot, jamais la couleur seule
 * (vérification daltonisme). Composant LOCAL à ce sous-domaine (pas dans `composants/identite/`,
 * hors périmètre d'écriture de cet agent) — même doctrine que `BadgeTypeDocument`/`BadgeEtatDocument`,
 * locaux à `ecrans/facturation/`.
 */
type TokenStatut = 'neutre' | 'info' | 'attention' | 'succes' | 'terminal' | 'danger';
type FormeBadge = 'plein' | 'contour';

interface EntreeStatut {
  readonly cle: string;
  readonly icone: LucideIcon;
  readonly token: TokenStatut;
  readonly forme: FormeBadge;
}

const CONFIG_STATUT: Readonly<Record<StatutDossierVente, EntreeStatut>> = {
  prospection: { cle: 'prospection', icone: Search, token: 'neutre', forme: 'contour' },
  engage: { cle: 'engage', icone: FileCheck, token: 'info', forme: 'plein' },
  en_preparation: { cle: 'enPreparation', icone: Wrench, token: 'info', forme: 'plein' },
  pret_a_livrer: { cle: 'pretALivrer', icone: PackageCheck, token: 'succes', forme: 'plein' },
  livre: { cle: 'livre', icone: KeyRound, token: 'succes', forme: 'plein' },
  clos: { cle: 'clos', icone: Lock, token: 'terminal', forme: 'contour' },
  // `Ban`/`UserX`, jamais une icône de suppression — même doctrine que `BadgeStatutOr`.
  annule: { cle: 'annule', icone: Ban, token: 'danger', forme: 'contour' },
  abandonne: { cle: 'abandonne', icone: UserX, token: 'danger', forme: 'contour' },
};

const CLASSES_PLEIN: Readonly<Record<TokenStatut, string>> = {
  neutre: 'border-transparent bg-statut-neutre-fond text-statut-neutre',
  info: 'border-transparent bg-statut-info-fond text-statut-info',
  attention: 'border-transparent bg-statut-attention-fond text-statut-attention',
  succes: 'border-transparent bg-statut-succes-fond text-statut-succes',
  terminal: 'border-transparent bg-statut-terminal-fond text-statut-terminal',
  danger: 'border-transparent bg-statut-danger-fond text-statut-danger',
};

const CLASSES_CONTOUR: Readonly<Record<TokenStatut, string>> = {
  neutre: 'border-statut-neutre bg-background text-statut-neutre',
  info: 'border-statut-info bg-background text-statut-info',
  attention: 'border-statut-attention bg-background text-statut-attention',
  succes: 'border-statut-succes bg-background text-statut-succes',
  terminal: 'border-statut-terminal bg-background text-statut-terminal',
  danger: 'border-statut-danger bg-background text-statut-danger',
};

interface Props {
  readonly statut: StatutDossierVente;
  readonly className?: string;
}

export function BadgeStatutDossierVente({ statut, className }: Props) {
  const { t } = useTranslation('ventes');
  const config = CONFIG_STATUT[statut];
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
      {t(`ventes:dossier.statuts.${config.cle}`)}
    </span>
  );
}
