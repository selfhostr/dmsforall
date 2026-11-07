import type { VehiculeResumeListe } from '@dfa/shared';

import { cn } from '@/lib/utils';

import { BadgeIdentificationIncomplete } from './BadgeIdentificationIncomplete';
import { Plaque } from './Plaque';

interface Props {
  readonly vehicule: VehiculeResumeListe;
  /** Taille de la `Plaque` composée. Bureau dense : `sm`/`md` ; fiche/tête d'écran : `xl`. */
  readonly taillePlaque?: 'sm' | 'md' | 'xl';
  readonly className?: string;
  /**
   * Lot B (`docs/plan-refonte-navigation.md`) — rend le bloc identité cliquable (ex. en-tête d'OR
   * ou de dossier de vente, vers la fiche véhicule). Omis : bloc statique STRICTEMENT INCHANGÉ,
   * même doctrine que `IdentiteClient.onClick` — comportement par défaut préservé pour tous les
   * appelants existants (listes, sélecteurs) qui ne doivent pas devenir cliquables par accident.
   * Quand fourni, un vrai `<button type="button">`, jamais un `<div onClick>`.
   */
  readonly onClick?: () => void;
}

/**
 * Identité véhicule — **une seule variante pour tout le produit** (invariant n°1, docs/plan-etape-1-frontend.md §11) :
 * `VD 123456 · VW Touran 2.0 TDI · 2018`. Aucun écran ne recompose ces trois informations
 * autrement ; un besoin d'affichage différent est un signe qu'il manque une variante ici, pas une
 * raison de le refaire localement.
 */
export function IdentiteVehicule({ vehicule, taillePlaque = 'md', className, onClick }: Props) {
  const annee = vehicule.premiereMiseEnCirculationLe
    ? new Date(vehicule.premiereMiseEnCirculationLe).getFullYear()
    : null;

  const contenu = (
    <>
      <Plaque canton={vehicule.canton} numero={vehicule.plaque} taille={taillePlaque} />
      <span aria-hidden className="text-muted-foreground">
        ·
      </span>
      <span className="truncate texte-corps font-medium text-foreground">
        {vehicule.designation}
      </span>
      {annee !== null ? (
        <>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          <span className="texte-libelle">{annee}</span>
        </>
      ) : null}
      {vehicule.identificationIncomplete ? (
        <BadgeIdentificationIncomplete
          identificationIncomplete={vehicule.identificationIncomplete}
        />
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          '-mx-1.5 -my-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-1.5 py-1 text-left transition-colors hover:text-primary anneau-focus',
          className,
        )}
      >
        {contenu}
      </button>
    );
  }

  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1', className)}>
      {contenu}
    </div>
  );
}
