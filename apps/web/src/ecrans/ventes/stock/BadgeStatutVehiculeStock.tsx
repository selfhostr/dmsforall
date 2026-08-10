import { CircleCheck, Lock, PackageCheck, Receipt, Truck, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutCommercialVehicule } from '@dfa/shared';

import { cn } from '@/lib/utils';

/**
 * Badge de statut commercial du véhicule en stock (`STATUTS_COMMERCIAUX_VEHICULE`, GELÉ) — même
 * patron que `BadgeStatutDossierVente` (ventes/dossiers) et `BadgeEcheanceSuivi` (ventes/suivi) :
 * forme + icône + mot, jamais la couleur seule. Remplace l'usage direct de `<Badge variant=...>`
 * qui recomposait un statut à la main — interdit par l'en-tête de `components/ui/badge.tsx`
 * (« un écran ne recompose JAMAIS un statut à la main avec `<Badge>` », famille 2 réservée aux
 * badges métier dédiés). Composant LOCAL à ce sous-domaine, comme ses deux pairs.
 */
type TokenStatut = 'neutre' | 'info' | 'attention' | 'succes' | 'terminal' | 'danger';
type FormeBadge = 'plein' | 'contour';

interface EntreeStatut {
  readonly icone: LucideIcon;
  readonly token: TokenStatut;
  readonly forme: FormeBadge;
}

// `en_commande`/`reserve` restent des étapes transitoires ; `disponible` est l'état qui intéresse
// le vendeur au comptoir (succès, mis en avant) ; `vendu`/`livre` sont des états terminaux — même
// hiérarchie de sens que l'ancien mapping `VARIANTE_BADGE_STATUT`, désormais porté par les jetons
// de couleur du Lot K plutôt que par les variantes neutres de `<Badge>`.
const CONFIG_STATUT: Readonly<Record<StatutCommercialVehicule, EntreeStatut>> = {
  en_commande: { icone: Truck, token: 'neutre', forme: 'contour' },
  disponible: { icone: CircleCheck, token: 'succes', forme: 'plein' },
  reserve: { icone: Lock, token: 'attention', forme: 'plein' },
  vendu: { icone: Receipt, token: 'terminal', forme: 'contour' },
  livre: { icone: PackageCheck, token: 'terminal', forme: 'contour' },
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
  readonly statut: StatutCommercialVehicule;
  readonly className?: string;
}

export function BadgeStatutVehiculeStock({ statut, className }: Props) {
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
      {t(`ventes:stock.statuts.${statut}`)}
    </span>
  );
}
