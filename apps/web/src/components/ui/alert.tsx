import { cva, type VariantProps } from 'class-variance-authority';
import { type HTMLAttributes, forwardRef } from 'react';

import { cn } from '@/lib/utils';

// Encart d'alerte de PAGE (« la facture est verrouillée », « le stock est négatif »), jamais un
// badge de statut. La variante `avertissement` utilisait des classes Tailwind en dur
// (`amber-500/50`, `bg-amber-50`, `text-amber-900`) : seule couleur codée en dur qui subsistait
// dans `components/ui/`. Elle passe par la famille de tokens `--avertissement-*` (index.css),
// distincte à la fois de la couleur de marque et des six tokens `--statut-*` réservés au statut
// d'OR et de ligne. Contraste mesuré : texte sur fond 7.66:1, bordure sur blanc 3.44:1.
const variantesAlerte = cva(
  'relative w-full rounded-lg border p-4 [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:h-4 [&>svg]:w-4 [&>svg~*]:pl-7',
  {
    variants: {
      variant: {
        default: 'bg-background text-foreground',
        destructive: 'border-destructive/50 text-destructive [&>svg]:text-destructive',
        avertissement:
          'border-avertissement-bordure bg-avertissement-fond text-avertissement [&>svg]:text-avertissement',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface AlertProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof variantesAlerte> {}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, ...props }, ref) => (
    <div
      ref={ref}
      role="alert"
      className={cn(variantesAlerte({ variant }), className)}
      {...props}
    />
  ),
);
Alert.displayName = 'Alert';

export const AlertTitle = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    // `texte-titre-section` (pas `texte-corps` + `font-semibold` manuel) : un encart d'alerte est
    // un conteneur titré au même titre qu'une Card/Dialog/Sheet — CardTitle/DialogTitle/SheetTitle
    // portent tous ce même rôle. Avant ce correctif, AlertTitle rendait 2px plus petit qu'un
    // CardTitle voisin à chaque densité (14/16/18 vs 16/18/20) : même rôle, deux tailles.
    <h5 ref={ref} className={cn('mb-1 texte-titre-section leading-none', className)} {...props} />
  ),
);
AlertTitle.displayName = 'AlertTitle';

export const AlertDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('texte-corps [&_p]:leading-relaxed', className)} {...props} />
));
AlertDescription.displayName = 'AlertDescription';
