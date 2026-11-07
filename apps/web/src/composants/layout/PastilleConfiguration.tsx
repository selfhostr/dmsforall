import { cn } from '@/lib/utils';

/**
 * Point neutre posé sur l'avatar (ou l'onglet « Plus ») tant que le garage reste à configurer.
 * Ni couleur d'accent ni feu de statut : le signal est la forme posée sur l'icône, et le sens est
 * porté en texte par le nom accessible du contrôle qui l'accueille.
 */
export function PastilleConfiguration({ className }: { readonly className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-testid="pastille-configuration"
      className={cn(
        'pointer-events-none absolute block h-2.5 w-2.5 rounded-full bg-muted-foreground ring-2 ring-background',
        className,
      )}
    />
  );
}
