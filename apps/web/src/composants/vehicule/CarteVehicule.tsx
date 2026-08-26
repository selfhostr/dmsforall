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
 *
 * Reste un `<div>` porteur d'un rôle ARIA plutôt qu'un `<button>`/`<a>` natif — la carte contient
 * elle-même un élément interactif (`BoutonCopier` sur le VIN, qui stoppe la propagation de son
 * clic) : imbriquer un `<button>` dans un `<button>` est invalide en HTML et casse la navigation
 * clavier/lecteur d'écran (élément interactif dans un élément interactif). Rôle `button` — pas
 * `link` comme dans une version antérieure — car le geste répond à Entrée ET Espace ; `link` ne
 * répond, dans les pratiques ARIA, qu'à Entrée : une carte qui accepte Espace sous l'étiquette
 * « link » n'est fiable pour aucun des deux contrats.
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
      role={onOuvrir ? 'button' : undefined}
      tabIndex={onOuvrir ? 0 : undefined}
      onClick={onOuvrir}
      onKeyDown={gererClavier}
      className={cn(
        // BORDURE CONSERVÉE (DESIGN.md « Bordure structurelle uniquement ») : contrairement à
        // `Card` (components/ui/), cette carte est un vrai contrôle de navigation quand `onOuvrir`
        // est fourni — zone d'action réelle, pas un simple groupe de contenu (même exception que
        // « carte cliquable d'un repli mobile de tableau », voir `TableComptoir.rendreCarte`).
        'flex flex-col gap-2 rounded-lg border bg-card p-carte text-card-foreground',
        // `anneau-focus` (utilitaire partagé, index.css) plutôt qu'un `ring`/`outline` refait à la
        // main : même mécanisme de focus que le reste du produit, dans les deux thèmes.
        onOuvrir && 'anneau-focus cursor-pointer transition-colors hover:bg-muted/50',
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
