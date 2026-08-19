import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import type { NatureEcartLigne } from './utils-factures-fournisseur';

interface Props {
  readonly nature: NatureEcartLigne;
  readonly className?: string;
}

/**
 * Marqueur d'écart d'une ligne de rapprochement facture <-> commande fournisseur — LE CŒUR du
 * brief : « l'information la plus importante de l'écran, elle doit sauter aux yeux — sans pour
 * autant crier au loup : un écart n'est pas une erreur, c'est un point à vérifier. »
 *
 * `--avertissement` (jamais `--destructive`, RÉSERVÉ à une vraie panne/erreur — voir la doctrine
 * du token dans `components/ui/alert.tsx`) : un écart de prix/quantité EST le cas d'usage nommé de
 * ce token dans ce dépôt. ICÔNE + MOT (jamais la seule couleur, même doctrine qu'`IndicateurCertitude`).
 *
 * `null` (nature `'aucun'`) : AUCUN rendu — pas de pastille verte « OK » qui ajouterait du bruit
 * visuel sur une ligne conforme, seule l'anomalie mérite d'attirer l'œil.
 */
export function PastilleEcart({ nature, className }: Props) {
  const { t } = useTranslation('pieces');

  if (nature === 'aucun') return null;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-avertissement-bordure bg-avertissement-fond px-2 py-0.5 texte-libelle font-medium text-avertissement',
        className,
      )}
    >
      <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {t(`pieces:facturesFournisseur.natureEcart.${nature}`)}
    </span>
  );
}
