import type { VehiculeResume } from '@dfa/shared';

import { Plaque } from '@/composants/identite/Plaque';

interface Props {
  readonly vehicule: VehiculeResume;
}

/**
 * Identité véhicule lisible à 1,5 m — BORNE d'atelier uniquement. `IdentiteVehicule` (partagée,
 * 16-18 px) reste la variante de tout le produit ; ici la plaque passe au palier `xl`
 * (`texte-donnee-proeminente`, 24 px sous `.densite-tres-aeree`) et la désignation à 24 px
 * (`text-2xl`). Aucun jeton de 24 px pour du texte courant n'existe dans `index.css` : classe
 * Tailwind posée localement, circonscrite à cet écran.
 */
export function VehiculeGrand({ vehicule }: Props) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <Plaque canton={vehicule.canton} numero={vehicule.plaque} taille="xl" />
      <span className="truncate text-2xl font-medium text-foreground">{vehicule.designation}</span>
    </div>
  );
}
