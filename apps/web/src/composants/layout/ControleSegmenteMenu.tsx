import type { LucideIcon } from 'lucide-react';

import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface OptionSegment<V extends string> {
  readonly valeur: V;
  /** Texte visible, court. */
  readonly libelleCourt: string;
  /** Nom accessible complet (lecteur d'écran, infobulle). */
  readonly libelleComplet: string;
  readonly icone?: LucideIcon;
  /** Classe de taille du texte (ex. `text-xs`), pour les contrôles de taille. */
  readonly classeTexte?: string;
}

interface Props<V extends string> {
  /** Identifiant unique du libellé de groupe (relie `aria-labelledby`). */
  readonly idLibelle: string;
  readonly libelle: string;
  readonly options: readonly OptionSegment<V>[];
  readonly valeur: V;
  readonly onChange: (valeur: V) => void;
}

/**
 * Contrôle segmenté à choix unique, rendu DANS un menu Radix (`DropdownMenuContent`) : libellé de
 * groupe + une ligne de segments. Chaque segment est un `DropdownMenuItem` de rôle `menuitemradio`
 * avec `aria-checked` — flèches, Entrée et focus restent gérés par le menu. `onSelect` empêche la
 * fermeture : le changement se voit tout de suite. Le choix actif se lit par la forme (fond plein),
 * le poids du texte ET `aria-checked`, jamais par la seule couleur. Jetons neutres uniquement.
 */
export function ControleSegmenteMenu<V extends string>({
  idLibelle,
  libelle,
  options,
  valeur,
  onChange,
}: Props<V>) {
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuGroup aria-labelledby={idLibelle}>
        <DropdownMenuLabel id={idLibelle} className="font-normal text-muted-foreground">
          {libelle}
        </DropdownMenuLabel>
        <div className="flex gap-1 px-2 pb-1">
          {options.map(({ valeur: v, libelleCourt, libelleComplet, icone: Icone, classeTexte }) => {
            const actif = v === valeur;
            return (
              <DropdownMenuItem
                key={v}
                role="menuitemradio"
                aria-checked={actif}
                aria-label={libelleComplet}
                title={libelleComplet}
                onSelect={(evenement) => {
                  evenement.preventDefault();
                  onChange(v);
                }}
                className={cn(
                  'min-h-11 flex-1 flex-col justify-center gap-0.5 rounded-md px-1 py-1 text-center',
                  classeTexte,
                  actif ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground',
                )}
              >
                {Icone ? <Icone className="h-4 w-4" aria-hidden="true" /> : null}
                {libelleCourt}
              </DropdownMenuItem>
            );
          })}
        </div>
      </DropdownMenuGroup>
    </>
  );
}
