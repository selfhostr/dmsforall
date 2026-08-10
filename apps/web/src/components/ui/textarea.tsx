import { type TextareaHTMLAttributes, forwardRef } from 'react';

import { CLASSES_CHAMP } from '@/components/ui/classes-champ';
import { cn } from '@/lib/utils';

// Habillage et cinq états partagés avec Input/DateInput/SelectTrigger : voir
// `classes-champ.ts`. Hauteur minimale de 88 px = deux fois la cible tactile : un champ
// multiligne qui ressemble à un champ d'une ligne se remplit comme un champ d'une ligne.
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(CLASSES_CHAMP, 'min-h-[88px]', className)} {...props} />
));
Textarea.displayName = 'Textarea';
