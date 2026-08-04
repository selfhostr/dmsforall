import { cva, type VariantProps } from 'class-variance-authority';
import { type HTMLAttributes, forwardRef } from 'react';

import { cn } from '@/lib/utils';

// Badge générique (neutre/secondaire/contour/destructif). Les badges de statut métier
// (BadgeStatutOr, BadgeStatutLigne — docs/design-etape-1-atelier.md §5.2/§5.3) sont des
// composants dédiés construits sur celui-ci dans src/composants/identite/, pas des variantes
// ici : le mapping enum → token + icône doit rester exhaustif et type-safe à cet endroit-là,
// pas dilué dans les variantes cva de cette primitive.
const variantesBadge = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-input text-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof variantesBadge> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cn(variantesBadge({ variant, className }))} {...props} />
  ),
);
Badge.displayName = 'Badge';
