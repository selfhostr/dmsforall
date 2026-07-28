import type { KeyboardEvent } from 'react';

import type { VehiculeResume } from '@dfa/shared';

import { IdentiteVehicule } from '@/composants/identite/IdentiteVehicule';
import { cn } from '@/lib/utils';

import { BoutonCopier } from './BoutonCopier';

export interface ProprietesCarteVehicule {
  readonly vehicule: VehiculeResume;
  /** Navigation vers la fiche. Omis dans un contexte déjà « sur » la fiche (en-tête) — la carte
   *  reste alors non cliquable. Toute la carte est la cible, jamais seulement la plaque
   *  (patron ligne cliquable, docs/design-comptoir.md §4). */
  readonly onOuvrir?: () => void;
  readonly className?: string;
}

/**
 * Identité compacte d'un véhicule — carte réutilisable en liste (véhicules liés à un client,
 * secondaire de fiche) et en en-tête de fiche. Compose `IdentiteVehicule` (invariant n°1,
 * `composants/identite/`) plutôt que de recomposer plaque/désignation/badge d'incomplétude
 * localement — c'est la SEULE variante d'identité véhicule pour tout le produit. Ne fait aucun
 * appel réseau : reçoit la projection `VehiculeResume` déjà résolue par l'appelant.
 */
export function CarteVehicule({ vehicule, onOuvrir, className }: ProprietesCarteVehicule) {
  function gererClavier(evenement: KeyboardEvent<HTMLDivElement>) {
    if (!onOuvrir) return;
    if (evenement.key === 'Enter' || evenement.key === ' ') {
      evenement.preventDefault();
      onOuvrir();
    }
  }

  return (
    <div
      role={onOuvrir ? 'link' : undefined}
      tabIndex={onOuvrir ? 0 : undefined}
      onClick={onOuvrir}
      onKeyDown={gererClavier}
      className={cn(
        'flex flex-col gap-2 rounded-lg border bg-card p-4 text-card-foreground',
        onOuvrir && 'cursor-pointer transition-colors hover:bg-muted/50',
        className,
      )}
    >
      <IdentiteVehicule vehicule={vehicule} taillePlaque="md" />
      {vehicule.vin ? (
        <span className="flex items-center gap-1 texte-libelle font-mono text-muted-foreground">
          {vehicule.vin}
          <BoutonCopier valeur={vehicule.vin} className="h-6 w-6" />
        </span>
      ) : null}
    </div>
  );
}
