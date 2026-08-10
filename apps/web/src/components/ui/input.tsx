import { type InputHTMLAttributes, forwardRef } from 'react';

import { CLASSES_CHAMP } from '@/components/ui/classes-champ';
import { cn } from '@/lib/utils';

// Habillage et cinq états partagés avec Textarea/DateInput/SelectTrigger : voir
// `classes-champ.ts`. Ici, uniquement ce qui est propre à un champ d'une ligne.
// h-11 (44px) : cible tactile minimale sur tablette d'atelier.
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input type={type} ref={ref} className={cn(CLASSES_CHAMP, 'h-11', className)} {...props} />
  ),
);
Input.displayName = 'Input';
