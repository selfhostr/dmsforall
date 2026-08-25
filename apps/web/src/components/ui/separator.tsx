import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';

import { cn } from '@/lib/utils';

// Source de vérité unique du filet de séparation. Avant ce correctif, `SelectSeparator`
// (select.tsx) et `DropdownMenuSeparator` (dropdown-menu.tsx) réimplémentaient chacun la même
// classe `-mx-1 my-1 h-px bg-border` via le sous-composant Separator de LEUR propre primitive
// Radix (`@radix-ui/react-select`, `@radix-ui/react-dropdown-menu`) au lieu de ce fichier —
// trois divergences possibles pour un même trait visuel. Ce sous-composant Radix par primitive
// n'apporte rien de plus que celui-ci (même rôle ARIA `separator`, aucune inscription dans la
// navigation clavier des items) : `SelectSeparator`/`DropdownMenuSeparator` composent maintenant
// ce `Separator`-ci directement. `CommandSeparator` (command.tsx) reste sur le sous-composant de
// `cmdk` : lui seul porte l'attribut `cmdk-separator` que `cmdk` utilise pour le masquer
// automatiquement quand un groupe filtré devient vide — un `Separator` générique ferait perdre
// ce comportement.
// Seule classe encore dupliquée hors de ce fichier : `command.tsx` doit garder le sous-composant
// `Separator` de `cmdk` (voir ci-dessus) et ne peut donc pas composer le `Separator` React
// ci-dessous, mais sa classe vient d'ici — plus de troisième version divergente à surveiller.
export const CLASSES_SEPARATOR_MENU = '-mx-1 my-1 h-px bg-border';

export const Separator = forwardRef<
  ElementRef<typeof SeparatorPrimitive.Root>,
  ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = 'horizontal', decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    orientation={orientation}
    decorative={decorative}
    className={cn(
      'shrink-0 bg-border',
      orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
      className,
    )}
    {...props}
  />
));
Separator.displayName = SeparatorPrimitive.Root.displayName;
