import { type HTMLAttributes, forwardRef } from 'react';

import { cn } from '@/lib/utils';

// Le rembourrage passe par les tokens sémantiques `--espace-carte` / `--espace-champ`
// (`p-carte`, `gap-champ`, index.css) et non plus par un `p-6` en dur : une carte posée dans
// une zone `.densite-dense` (comptoir) se resserre à 16 px, une carte de tablette d'atelier
// garde 24 px, sans qu'aucun écran n'ait à s'en occuper. Hors de tout contexte de densité, la
// valeur de `:root` vaut 24 px — soit exactement le rendu d'avant le Lot K.
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-champ p-carte', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2 ref={ref} className={cn('texte-titre-section leading-none', className)} {...props} />
  ),
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('texte-corps text-muted-foreground', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-carte pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex items-center gap-controles p-carte pt-0', className)}
      {...props}
    />
  ),
);
CardFooter.displayName = 'CardFooter';
