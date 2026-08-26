import {
  Ban,
  Lock,
  PackageCheck,
  PackageOpen,
  PencilLine,
  Send,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutCommandeFournisseur } from '@dfa/shared';

import { BadgeStatut, type FormeBadge, type TokenStatut } from '@/composants/identite/BadgeStatut';

/**
 * Badge de statut d'une commande fournisseur (`STATUTS_COMMANDE_FOURNISSEUR`, machine à états
 * GELÉE, §6.2) — même patron que `BadgeStatutDossierVente` : forme + icône + mot, jamais la
 * couleur seule. Remplace l'usage direct de `<Badge variant={VARIANTE_BADGE_STATUT[...]}>` dans
 * `EcranListeCommandesFournisseur.tsx` et `EcranFicheCommandeFournisseur.tsx` — interdit par
 * l'en-tête de `components/ui/badge.tsx`. Corrige au passage `EcranFicheCommandeFournisseur.tsx`,
 * qui typait sa table `Record<string, ...>` au lieu de `Record<StatutCommandeFournisseur, ...>` —
 * une valeur ajoutée à l'enum n'y aurait pas fait échouer `tsc`.
 */
interface EntreeStatut {
  readonly icone: LucideIcon;
  readonly token: TokenStatut;
  readonly forme: FormeBadge;
}

const CONFIG_STATUT: Readonly<Record<StatutCommandeFournisseur, EntreeStatut>> = {
  brouillon: { icone: PencilLine, token: 'neutre', forme: 'contour' },
  envoyee: { icone: Send, token: 'info', forme: 'plein' },
  partiellement_recue: { icone: PackageOpen, token: 'attention', forme: 'plein' },
  recue: { icone: PackageCheck, token: 'succes', forme: 'plein' },
  // Contour, jamais plein — même doctrine que `BadgeStatutDossierVente.clos`.
  cloturee: { icone: Lock, token: 'terminal', forme: 'contour' },
  // Contour, jamais plein — même doctrine que `BadgeStatutReprise.refusee` : une commande annulée
  // est un fait courant du parcours, pas une erreur produit.
  annulee: { icone: Ban, token: 'danger', forme: 'contour' },
};

interface Props {
  readonly statut: StatutCommandeFournisseur;
  readonly className?: string;
}

export function BadgeStatutCommandeFournisseur({ statut, className }: Props) {
  const { t } = useTranslation('pieces');
  const config = CONFIG_STATUT[statut];

  return (
    <BadgeStatut
      icone={config.icone}
      token={config.token}
      forme={config.forme}
      className={className}
    >
      {t(`pieces:commandes.statuts.${statut}`)}
    </BadgeStatut>
  );
}
