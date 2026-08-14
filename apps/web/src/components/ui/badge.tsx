import { cva, type VariantProps } from 'class-variance-authority';
import { type HTMLAttributes, forwardRef } from 'react';

import { cn } from '@/lib/utils';

// Badge générique (neutre/secondaire/contour/destructif). Les badges de statut métier
// (BadgeStatutOr, BadgeStatutLigne — docs/design-etape-1-atelier.md §5.2/§5.3) sont des
// composants dédiés construits sur celui-ci dans src/composants/identite/, pas des variantes
// ici : le mapping enum → token + icône doit rester exhaustif et type-safe à cet endroit-là,
// pas dilué dans les variantes cva de cette primitive.
//
// LEQUEL CHOISIR (Lot K, tâche 4) — trois familles, jamais interchangeables :
//   1. `Badge` (ici) — étiquette NEUTRE, sans sémantique de statut : un compteur, un type de
//      document, un libellé court. Aucune de ses variantes ne dit « où en est cet OR ».
//   2. Badges métier de `composants/identite/` (`BadgeStatutOr`, `BadgeStatutClient`,
//      `BadgeTypeClient`, `BadgeEcheanceExpertise`, `BadgeIdentificationIncomplete`,
//      `BadgeImporte`) — SEULS habilités à porter un état métier. Ils garantissent
//      couleur + forme + icône + mot traduit, et l'exhaustivité du mapping est vérifiée par le
//      typage. Un écran ne recompose JAMAIS un statut à la main avec `<Badge>`.
//   3. Pastilles `--statut-*` — les six tokens de couleur eux-mêmes, réservés au statut d'OR et
//      de ligne (voir l'en-tête de leur bloc dans index.css). On ne les emploie pas
//      directement dans un écran : on passe par la famille 2.
// Une pastille de NOTIFICATION de menu (compteur du menu latéral) relève de la famille 1 et ne
// doit reprendre aucun des six tokens de statut, sous peine de laisser croire qu'elle porte un
// état d'OR.
// `texte-libelle` (pas `text-xs` brut) : identique en densité dense (12px, les deux valent
// 0.75rem) mais scale avec la densité en aérée/très-aérée (14/16px), comme les huit badges de
// statut métier de `composants/identite/` (BadgeStatutOr, BadgeStatutClient…), qui utilisent tous
// `texte-libelle font-medium` pour ce même rôle « étiquette ». Un `<Badge>` générique posé à côté
// d'un badge de statut sur un écran de tablette (`densite-aeree`) rendait sinon 2px plus petit.
const variantesBadge = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 texte-libelle font-medium transition-colors anneau-focus',
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
