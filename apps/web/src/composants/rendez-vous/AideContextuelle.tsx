import { CircleHelp } from 'lucide-react';
import type { ReactNode } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface Props {
  /** Nom accessible du bouton « ? » (ex. « Aide : le planning »). */
  readonly libelle: string;
  readonly children: ReactNode;
}

/**
 * Bouton « ? » qui ouvre une courte aide. Popover (clic/toucher, clavier) plutôt qu'une info-bulle
 * au survol : sur tablette il n'y a pas de survol, et le texte doit rester lisible le temps de le
 * lire. Cible tactile 44px (DESIGN.md).
 */
export function AideContextuelle({ libelle, children }: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={libelle}
          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground anneau-focus"
        >
          <CircleHelp aria-hidden className="h-5 w-5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="max-w-sm">{children}</PopoverContent>
    </Popover>
  );
}
