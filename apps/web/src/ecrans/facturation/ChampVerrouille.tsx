import type { ReactNode } from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface Props {
  readonly enfant: ReactNode;
  /** Déjà traduit par l'appelant (`facturation:verrouille.message` ou
   *  `facturation:paiementVerrouille.message`) — ce composant ne porte aucun texte métier en dur,
   *  il sert la table de lignes ET l'historique des paiements (§4.6, §5.4). */
   readonly message: string;
  readonly libelleAction: string;
  readonly onAction: () => void;
  readonly className?: string;
}

/**
 * Pattern « champ verrouillé » (§4.6, §5.4, composant `ChampVerrouille` du design §8) : le clic ou
 * le focus clavier sur un champ figé d'un document/paiement émis ouvre un `Popover` court —
 * pourquoi c'est verrouillé, et l'action de correction à faire à la place. Jamais un no-op
 * silencieux : c'est la réponse concrète à « le réceptionniste qui veut juste corriger une faute de
 * frappe doit comprendre pourquoi il ne peut pas et voir immédiatement quoi faire à la place ».
 */
export function ChampVerrouille({ enfant, message, libelleAction, onAction, className }: Props) {
  return (
    <Popover>
      {/* `role="button"` + `tabIndex=0` plutôt qu'un `<button>` natif : ce composant enveloppe des
       *  blocs de contenu potentiellement riches (adresse multi-lignes, cellule de tableau) — un
       *  `<button>` autour d'un contenu de bloc casserait le HTML dans certains contextes (ex. une
       *  table). `onKeyDown` traduit explicitement Entrée/Espace en activation, pour que « clic OU
       *  focus clavier » (§4.6) reste garanti sans dépendre de la sémantique native d'un bouton. */}
      <PopoverTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          className={cn(
            'w-full cursor-default rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
          onKeyDown={(evenement) => {
            if (evenement.key === 'Enter' || evenement.key === ' ') {
              evenement.preventDefault();
              evenement.currentTarget.click();
            }
          }}
        >
          {enfant}
        </div>
      </PopoverTrigger>
      <PopoverContent className="flex flex-col gap-2">
        <p className="text-muted-foreground">{message}</p>
        <button type="button" className="text-left font-medium text-primary underline-offset-2 hover:underline" onClick={onAction}>
          {libelleAction}
        </button>
      </PopoverContent>
    </Popover>
  );
}
