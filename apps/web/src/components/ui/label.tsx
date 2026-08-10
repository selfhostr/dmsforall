import * as LabelPrimitive from '@radix-ui/react-label';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';

import { cn } from '@/lib/utils';

export const Label = forwardRef<
  ElementRef<typeof LabelPrimitive.Root>,
  ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      'texte-corps font-medium leading-none text-foreground',
      // `text-muted-foreground` plutôt qu'`opacity-70` : un libellé doit rester LISIBLE quand
      // son champ est désactivé (il nomme une valeur qu'on doit encore pouvoir lire), il doit
      // seulement paraître inactif. À 70 % d'opacité il tombait à 2.9:1.
      'peer-disabled:cursor-not-allowed peer-disabled:text-muted-foreground',
      className,
    )}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;
