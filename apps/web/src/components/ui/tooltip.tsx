import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';

import { cn } from '@/lib/utils';

// Superposition : reste sur Radix (voir CLAUDE.md, exception des composants à portail). Le
// fournisseur est posé ici, à chaque `Tooltip`, pour qu'aucun écran ni test n'ait à monter un
// `TooltipProvider` global : le délai d'ouverture est court et identique partout.

export const Tooltip = ({
  delayDuration = 200,
  ...props
}: ComponentPropsWithoutRef<typeof TooltipPrimitive.Root> & { delayDuration?: number }) => (
  <TooltipPrimitive.Provider delayDuration={delayDuration}>
    <TooltipPrimitive.Root {...props} />
  </TooltipPrimitive.Provider>
);

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
        'z-50 max-w-xs rounded-md border border-border bg-popover px-3 py-1.5 texte-corps text-popover-foreground shadow-md',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;
