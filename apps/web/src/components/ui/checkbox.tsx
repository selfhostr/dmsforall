import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';

import { cn } from '@/lib/utils';

// API composée standard shadcn (`checked`/`onCheckedChange`), à la différence de l'ancienne
// implémentation sur <input type="checkbox"> natif (voir docs/design-comptoir.md §3) :
// changement d'appel assumé, aucun écran consommateur à ce jour.
//
// La racine Radix (un <button role="checkbox">) est elle-même la cible tactile 44x44 — la case
// visuelle 20x20 est un enfant centré dedans, stylé par l'attribut `data-state` posé par Radix
// sur la racine (`group`), pas par un sélecteur `peer` (il n'y a plus d'input frère ici).
export const Checkbox = forwardRef<
  ElementRef<typeof CheckboxPrimitive.Root>,
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'group inline-flex h-11 w-11 shrink-0 items-center justify-center rounded outline-none',
      'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none flex h-5 w-5 items-center justify-center rounded border border-input bg-background transition-colors',
        'group-data-[state=checked]:border-primary group-data-[state=checked]:bg-primary',
      )}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-primary-foreground">
        <Check aria-hidden="true" className="h-3.5 w-3.5" />
      </CheckboxPrimitive.Indicator>
    </span>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;
