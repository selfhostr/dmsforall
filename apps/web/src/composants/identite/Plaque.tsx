import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const variantesPlaque = cva(
  'inline-flex w-fit items-center gap-1 rounded border border-input bg-muted font-semibold tabular-nums text-foreground',
  {
    variants: {
      taille: {
        sm: 'h-5 px-1 text-xs',
        md: 'h-6 px-1.5 text-sm',
        xl: 'h-10 px-3 text-2xl',
      },
    },
    defaultVariants: { taille: 'md' },
  },
);

interface Props extends VariantProps<typeof variantesPlaque> {
  /** Code canton (2 lettres), `null` pour une plaque étrangère sans canton connu. */
  readonly canton: string | null;
  /** Numéro de plaque. `null` si le véhicule n'en porte aucune aujourd'hui (RM-17) — le
   *  composant ne rend alors rien de saillant, juste un tiret neutre. */
  readonly numero: string | null;
  readonly className?: string;
}

/** Plaque d'immatriculation — canton + numéro, `tabular-nums`, une seule variante visuelle pour
 *  tout le produit (invariant n°1 : `IdentiteVehicule` compose ce composant, ne réimplémente
 *  jamais l'affichage d'une plaque). `canton` et `numero` sont deux champs distincts côté contrat
 *  (`VehiculeResume`) : ce composant est le seul endroit qui les recompose visuellement. */
export function Plaque({ canton, numero, taille, className }: Props) {
  if (!numero) {
    return <span className={cn('texte-libelle text-muted-foreground', className)}>—</span>;
  }

  return (
    <span className={cn(variantesPlaque({ taille }), className)}>
      {canton ? <span className="text-muted-foreground">{canton}</span> : null}
      <span>{numero}</span>
    </span>
  );
}
