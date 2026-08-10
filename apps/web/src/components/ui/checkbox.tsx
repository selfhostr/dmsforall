import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';

import { cn } from '@/lib/utils';

// API composée standard shadcn (`checked`/`onCheckedChange`), à la différence de l'ancienne
// implémentation sur <input type="checkbox"> natif (voir docs/design-comptoir.md §3) :
// changement d'appel assumé, documenté comme tel dans ce même document.
//
// La racine Radix (un <button role="checkbox">) est elle-même la cible tactile 44x44 — la case
// visuelle 20x20 est un enfant centré dedans, stylé par l'attribut `data-state` posé par Radix
// sur la racine (`group`), pas par un sélecteur `peer` (il n'y a plus d'input frère ici).
//
// Cinq états (Lot K) : repos (contour `--input`, 3.49:1), survol (le contour prend la couleur
// de marque — il n'existait aucun état de survol avant, la case ne réagissait pas au pointeur),
// focus (`.anneau-focus` posé sur la cible de 44 px, donc l'anneau entoure la zone réellement
// cliquable et pas la petite case), désactivé, et l'état indéterminé de Radix — rendu par un
// tiret et non par une coche à demi effacée, parce que « je ne sais pas » et « c'est faux » ne
// se rendent jamais pareil (règle CONTRIBUTING.md : une absence de donnée n'est pas une valeur).
export const Checkbox = forwardRef<
  ElementRef<typeof CheckboxPrimitive.Root>,
  ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'group inline-flex h-11 w-11 shrink-0 items-center justify-center rounded outline-none',
      'anneau-focus',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none flex h-5 w-5 items-center justify-center rounded border border-input bg-background transition-colors',
        'group-hover:border-marque',
        'group-data-[state=checked]:border-primary group-data-[state=checked]:bg-primary',
        'group-data-[state=checked]:group-hover:border-primary-fort group-data-[state=checked]:group-hover:bg-primary-fort',
        'group-data-[state=indeterminate]:border-primary group-data-[state=indeterminate]:bg-primary',
      )}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-primary-foreground">
        {props.checked === 'indeterminate' ? (
          <Minus aria-hidden="true" className="h-3.5 w-3.5" />
        ) : (
          <Check aria-hidden="true" className="h-3.5 w-3.5" />
        )}
      </CheckboxPrimitive.Indicator>
    </span>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;
