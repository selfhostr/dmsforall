import type { VehiculeResume } from '@dfa/shared';

import { cn } from '@/lib/utils';

import { BadgeIdentificationIncomplete } from './BadgeIdentificationIncomplete';
import { Plaque } from './Plaque';

interface Props {
  readonly vehicule: VehiculeResume;
  /** Taille de la `Plaque` composée. Bureau dense : `sm`/`md` ; fiche/tête d'écran : `xl`. */
  readonly taillePlaque?: 'sm' | 'md' | 'xl';
  readonly className?: string;
}

/**
 * Identité véhicule — **une seule variante pour tout le produit** (invariant n°1, docs/plan-etape-1-frontend.md §11) :
 * `VD 123456 · VW Touran 2.0 TDI · 2018`. Aucun écran ne recompose ces trois informations
 * autrement ; un besoin d'affichage différent est un signe qu'il manque une variante ici, pas une
 * raison de le refaire localement.
 */
export function IdentiteVehicule({ vehicule, taillePlaque = 'md', className }: Props) {
  const annee = vehicule.premiereMiseEnCirculationLe
    ? new Date(vehicule.premiereMiseEnCirculationLe).getFullYear()
    : null;

  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1', className)}>
      <Plaque canton={vehicule.canton} numero={vehicule.plaque} taille={taillePlaque} />
      <span aria-hidden className="text-muted-foreground">
        ·
      </span>
      <span className="truncate texte-corps font-medium text-foreground">{vehicule.designation}</span>
      {annee !== null ? (
        <>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          <span className="texte-libelle">{annee}</span>
        </>
      ) : null}
      {vehicule.identificationIncomplete ? (
        <BadgeIdentificationIncomplete identificationIncomplete={vehicule.identificationIncomplete} />
      ) : null}
    </div>
  );
}
