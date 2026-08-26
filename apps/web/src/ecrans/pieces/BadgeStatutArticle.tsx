import { Archive, CircleCheck, Lock, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutArticle } from '@dfa/shared';

import { BadgeStatut, type FormeBadge, type TokenStatut } from '@/composants/identite/BadgeStatut';

/**
 * Badge de statut d'un article (`STATUTS_ARTICLE`) — même patron que `BadgeStatutDossierVente`
 * (`ecrans/ventes/dossiers/`) : forme + icône + mot, jamais la couleur seule. Remplace l'usage
 * direct de `<Badge variant={VARIANTE_BADGE_STATUT[...]}>` dans `EcranListeArticles.tsx` et
 * `EnTeteFicheArticle.tsx` — interdit par l'en-tête de `components/ui/badge.tsx` (« un écran ne
 * recompose JAMAIS un statut à la main avec `<Badge>` »).
 */
interface EntreeStatut {
  readonly icone: LucideIcon;
  readonly token: TokenStatut;
  readonly forme: FormeBadge;
}

const CONFIG_STATUT: Readonly<Record<StatutArticle, EntreeStatut>> = {
  actif: { icone: CircleCheck, token: 'succes', forme: 'plein' },
  obsolete: { icone: Archive, token: 'attention', forme: 'contour' },
  // Contour, jamais plein — désactiver un article est un fait courant du cycle de vie (§6.1), pas
  // une erreur produit ; même doctrine que `BadgeStatutDossierVente.clos`.
  desactive: { icone: Lock, token: 'terminal', forme: 'contour' },
};

interface Props {
  readonly statut: StatutArticle;
  readonly className?: string;
}

export function BadgeStatutArticle({ statut, className }: Props) {
  const { t } = useTranslation('pieces');
  const config = CONFIG_STATUT[statut];

  return (
    <BadgeStatut
      icone={config.icone}
      token={config.token}
      forme={config.forme}
      className={className}
    >
      {t(`pieces:articles.statuts.${statut}`)}
    </BadgeStatut>
  );
}
