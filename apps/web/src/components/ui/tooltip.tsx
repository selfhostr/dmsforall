import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';

import { cn } from '@/lib/utils';

// À réserver à l'information complémentaire (marqueurs, troncature), jamais à une donnée
// indispensable à la décision — même règle qu'avant la bascule Radix, voir
// docs/design-comptoir.md §3 : Radix gère le délai, le montage/démontage du focus et le
// portail, mais la règle de contenu ne change pas.
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = forwardRef<
  ElementRef<typeof TooltipPrimitive.Content>,
  ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        // PAS `texte-libelle` ici : cet utilitaire impose lui-même `--muted-foreground` et
        // l'emporte sur le `text-background` posé à côté (même spécificité, déclaré plus tard
        // dans index.css). L'infobulle rendait donc du gris moyen sur fond quasi noir — 2.6:1,
        // sous le seuil AA. Taille posée explicitement, la densité n'a pas de sens ici.
        'z-50 max-w-xs rounded-md bg-foreground px-2 py-1 text-xs leading-4 text-background shadow-md',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;
