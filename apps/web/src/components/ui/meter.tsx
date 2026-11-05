// Adapté de coss (https://github.com/cosscom/coss, apps/ui/registry/default/ui/meter.tsx,
// licence MIT — voir apps/ui/LICENSING.md du dépôt source : seuls apps/origin/ et apps/ui/ y
// sont MIT, le reste du dépôt coss est AGPL-3.0, ne JAMAIS copier depuis un autre répertoire). Couche
// de primitive Base UI (`@base-ui/react/meter`, MIT) au lieu de Radix — voir la note sur la
// cohabitation des deux bibliothèques dans CONTRIBUTING.md. Composant « feuille » : ni portail, ni
// piège de focus, ni superposition — le seul écart mesuré par rapport à Radix est purement
// visuel (jetons de thème), pas comportemental.
//
// Adaptations au projet : classes `bg-input`/`bg-primary`/`text-foreground`/`text-muted-foreground`
// déjà connues (mêmes jetons `@theme inline` qu'ailleurs, voir index.css) ; `MeterLabel` posé sur
// `texte-libelle` et `MeterValue` sur `tabular-nums` pour rester alignés sur l'échelle
// typographique et le rythme de densité du produit plutôt que sur les tailles fixes de coss.
'use client';

import { Meter as MeterPrimitive } from '@base-ui/react/meter';
import type { ComponentProps, ReactElement } from 'react';

import { cn } from '@/lib/utils';

export function Meter({ className, children, ...props }: MeterPrimitive.Root.Props): ReactElement {
  return (
    <MeterPrimitive.Root className={cn('flex w-full flex-col gap-champ', className)} {...props}>
      {children ?? (
        <MeterTrack>
          <MeterIndicator />
        </MeterTrack>
      )}
    </MeterPrimitive.Root>
  );
}

export function MeterLabel({
  className,
  ...props
}: ComponentProps<typeof MeterPrimitive.Label>): ReactElement {
  return (
    <MeterPrimitive.Label
      className={cn('texte-libelle font-medium text-foreground', className)}
      data-slot="meter-label"
      {...props}
    />
  );
}

export function MeterTrack({
  className,
  ...props
}: ComponentProps<typeof MeterPrimitive.Track>): ReactElement {
  return (
    <MeterPrimitive.Track
      className={cn('block h-3 w-full overflow-hidden rounded-full bg-muted', className)}
      data-slot="meter-track"
      {...props}
    />
  );
}

export function MeterIndicator({
  className,
  ...props
}: ComponentProps<typeof MeterPrimitive.Indicator>): ReactElement {
  return (
    <MeterPrimitive.Indicator
      className={cn(
        'rounded-full bg-primary transition-[width] duration-[var(--duree-normale)] ease-[var(--courbe-standard)]',
        className,
      )}
      data-slot="meter-indicator"
      {...props}
    />
  );
}

export function MeterValue({
  className,
  ...props
}: ComponentProps<typeof MeterPrimitive.Value>): ReactElement {
  return (
    <MeterPrimitive.Value
      className={cn('texte-libelle font-medium tabular-nums', className)}
      data-slot="meter-value"
      {...props}
    />
  );
}
