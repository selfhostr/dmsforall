import { GitCompare, Inbox, XCircle, CheckCircle2, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutFactureFournisseur } from '@dfa/shared';

import { BadgeStatut, type FormeBadge, type TokenStatut } from '@/composants/identite/BadgeStatut';

/**
 * Badge de statut d'une facture fournisseur (`STATUTS_FACTURE_FOURNISSEUR`, machine à états
 * GELÉE — engage de l'argent) — même patron que `BadgeStatutReglement` (`ecrans/facturation/`) :
 * forme + icône + mot, jamais la couleur seule. Remplace l'usage direct de
 * `<Badge variant={VARIANTE_BADGE_STATUT[...]}>` dans `EcranListeFacturesFournisseur.tsx` et
 * `PanneauRapprochementFacture.tsx` — interdit par l'en-tête de `components/ui/badge.tsx`.
 */
interface EntreeStatut {
  readonly icone: LucideIcon;
  readonly token: TokenStatut;
  readonly forme: FormeBadge;
}

const CONFIG_STATUT: Readonly<Record<StatutFactureFournisseur, EntreeStatut>> = {
  deposee: { icone: Inbox, token: 'neutre', forme: 'contour' },
  rapprochee: { icone: GitCompare, token: 'info', forme: 'plein' },
  validee: { icone: CheckCircle2, token: 'succes', forme: 'plein' },
  // Plein, pas contour — une facture rejetée engage une action réelle (renvoi au fournisseur),
  // même doctrine que `BadgeStatutReglement.irrecouvrable`.
  rejetee: { icone: XCircle, token: 'danger', forme: 'plein' },
};

interface Props {
  readonly statut: StatutFactureFournisseur;
  readonly className?: string;
}

export function BadgeStatutFactureFournisseur({ statut, className }: Props) {
  const { t } = useTranslation('pieces');
  const config = CONFIG_STATUT[statut];

  return (
    <BadgeStatut
      icone={config.icone}
      token={config.token}
      forme={config.forme}
      className={className}
    >
      {t(`pieces:facturesFournisseur.statuts.${statut}`)}
    </BadgeStatut>
  );
}
