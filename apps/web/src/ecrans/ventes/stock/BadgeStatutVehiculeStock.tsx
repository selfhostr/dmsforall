import { CircleCheck, Lock, PackageCheck, Receipt, Truck, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { StatutCommercialVehicule } from '@dfa/shared';

import { BadgeStatut, type FormeBadge, type TokenStatut } from '@/composants/identite/BadgeStatut';

/**
 * Badge de statut commercial du véhicule en stock (`STATUTS_COMMERCIAUX_VEHICULE`, GELÉ) — même
 * patron que `BadgeStatutDossierVente` (ventes/dossiers) et `BadgeEcheanceSuivi` (ventes/suivi) :
 * forme + icône + mot, jamais la couleur seule. Remplace l'usage direct de `<Badge variant=...>`
 * qui recomposait un statut à la main — interdit par l'en-tête de `components/ui/badge.tsx`
 * (« un écran ne recompose JAMAIS un statut à la main avec `<Badge>` », famille 2 réservée aux
 * badges métier dédiés). Le rendu et les classes des tokens `--statut-*` sont factorisés dans
 * `BadgeStatut` (`composants/identite/`), partagé avec `BadgeStatutOr` et
 * `BadgeStatutDossierVente` ; seul le mapping métier ci-dessous reste local à ce sous-domaine.
 */
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

interface Props {
  readonly statut: StatutCommercialVehicule;
  readonly className?: string;
}

export function BadgeStatutVehiculeStock({ statut, className }: Props) {
  const { t } = useTranslation('ventes');
  const config = CONFIG_STATUT[statut];

  return (
    <BadgeStatut
      icone={config.icone}
      token={config.token}
      forme={config.forme}
      className={className}
    >
      {t(`ventes:stock.statuts.${statut}`)}
    </BadgeStatut>
  );
}
