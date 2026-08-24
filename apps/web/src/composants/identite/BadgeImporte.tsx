import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { ImportationVehicule } from '@dfa/shared';

import { BadgeAttribut } from './BadgeAttribut';

interface Props {
  readonly importation: ImportationVehicule;
  readonly className?: string;
}

/** Origine étrangère du véhicule (RM-27) — forme + mot, jamais de couleur de la palette statut.
 *  Ne rend rien pour un véhicule d'origine suisse : ce badge ne signale qu'un écart.
 *
 *  Gardé en réserve, non câblé : la liste des véhicules (`EcranListeVehicules`, candidat naturel
 *  pour une pastille par ligne — elle filtre déjà par `importe`) reçoit `VehiculeResume`, qui
 *  n'expose pas `ImportationVehicule` (voir `packages/shared/src/contrats/atelier/vehicule.ts` —
 *  seule `ReponseVehicule`, la fiche complète, le porte). La fiche véhicule, elle, montre déjà
 *  cette information via `EncartAlertesVehicule` (ligne d'alerte avec pays et date, plus riche
 *  qu'une pastille) : y ajouter ce badge serait redondant. À câbler dans la liste si `estImporte`
 *  rejoint un jour cette projection côté API. */
export function BadgeImporte({ importation, className }: Props) {
  const { t } = useTranslation('vehicules');

  if (!importation.estImporte) {
    return null;
  }

  return (
    <BadgeAttribut
      icone={<Globe aria-hidden className="h-3.5 w-3.5 shrink-0" />}
      className={className}
    >
      {t('vehicules:importation.importe')}
    </BadgeAttribut>
  );
}
