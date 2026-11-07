import type { ReactElement } from 'react';

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export interface OptionSegment<T extends string> {
  readonly valeur: T;
  readonly libelle: string;
  /** Nom complet, lu par les lecteurs d'écran et au survol quand `libelle` est une abréviation. */
  readonly titre?: string;
}

interface Props<T extends string> {
  readonly valeur: T;
  readonly onChange: (valeur: T) => void;
  readonly options: readonly OptionSegment<T>[];
  /** Nom accessible du groupe (obligatoire : un `tablist` sans nom ne dit pas ce qu'il filtre). */
  readonly ariaLabel: string;
}

/**
 * Sélecteur segmenté (bascule liste/plan, horizon, filtre par onglet) : UN SEUL composant pour
 * tout le produit. Cible de 44 px (`--cible-tactile`), rôles ARIA `tablist`/`tab`, flèches,
 * Home/End (Base UI). Les segments FILTRENT une vue unique rendue hors du composant (pas de
 * panneau par segment, donc pas d'`aria-controls` cassé — voir `components/ui/tabs.tsx`).
 */
export function Segments<T extends string>({
  valeur,
  onChange,
  options,
  ariaLabel,
}: Props<T>): ReactElement {
  return (
    <Tabs value={valeur} onValueChange={(v) => onChange(v as T)}>
      <TabsList variante="segments" aria-label={ariaLabel}>
        {options.map((option) => (
          <TabsTrigger
            key={option.valeur}
            value={option.valeur}
            title={option.titre}
            aria-label={option.titre}
          >
            {option.libelle}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
