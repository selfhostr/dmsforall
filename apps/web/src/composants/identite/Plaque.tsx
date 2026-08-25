import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const variantesPlaque = cva(
  'inline-flex w-fit items-center gap-1 rounded border border-input bg-muted font-semibold tabular-nums text-foreground',
  {
    variants: {
      taille: {
        sm: 'h-5 px-1 texte-petit',
        md: 'h-6 px-1.5 texte-corps',
        // `.texte-donnee-proeminente` et non `.texte-titre-page` : une plaque n'est ni un titre
        // ni un libellé, mais à cette taille c'est la donnée mise en avant sur l'écran (fiche
        // véhicule) — exactement le rôle que la table décrit, tabular-nums et poids inclus.
        xl: 'h-10 px-3 texte-donnee-proeminente',
      },
    },
    defaultVariants: { taille: 'md' },
  },
);

interface Props extends VariantProps<typeof variantesPlaque> {
  /** Code canton (2 lettres), `null` pour une plaque étrangère sans canton connu. Sert
   *  uniquement à styliser le préfixe canton déjà présent dans `numero` (voir plus bas) — jamais
   *  à le préfixer une seconde fois. */
  readonly canton: string | null;
  /** Numéro de plaque tel que rendu par le serveur (`VehiculeResume.plaque` /
   *  `ReponseVehiculePlaque.valeur`) : le canton y est **déjà inclus** en préfixe suisse
   *  standard (`VS 123456`) — `canton` est un champ structuré redondant côté contrat, pas un
   *  fragment à concaténer. `null` si le véhicule n'en porte aucune aujourd'hui (RM-17) — le
   *  composant ne rend alors rien de saillant, juste un tiret neutre. */
  readonly numero: string | null;
  readonly className?: string;
}

/** Plaque d'immatriculation — canton + numéro, `tabular-nums`, une seule variante visuelle pour
 *  tout le produit (invariant n°1 : `IdentiteVehicule` compose ce composant, ne réimplémente
 *  jamais l'affichage d'une plaque). `numero` porte déjà le canton en préfixe côté contrat ; ce
 *  composant ne fait que le distinguer visuellement (gris) du reste, il ne le RECOMPOSE jamais —
 *  le refaire produirait un doublon (`VS VS 123456`). */
export function Plaque({ canton, numero, taille, className }: Props) {
  if (!numero) {
    return <span className={cn('texte-libelle text-muted-foreground', className)}>—</span>;
  }

  const prefixeCanton = canton && numero.startsWith(`${canton} `) ? canton : null;
  const reste = prefixeCanton ? numero.slice(prefixeCanton.length + 1) : numero;

  return (
    <span className={cn(variantesPlaque({ taille }), className)}>
      {prefixeCanton ? <span className="text-muted-foreground">{prefixeCanton}</span> : null}
      <span>{reste}</span>
    </span>
  );
}
