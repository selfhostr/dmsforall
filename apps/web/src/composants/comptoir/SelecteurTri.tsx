import { ArrowUpDown, Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface OptionTri {
  /** Forme `<champ>:<asc|desc>` (voir `REGEX_TRI`, @dfa/shared) : branchable tel quel sur le
   *  paramètre `tri` de l'API. */
  readonly valeur: string;
  /** Déjà traduit par l'appelant (namespace du domaine). */
  readonly libelle: string;
}

export interface ProprietesSelecteurTri {
  readonly id?: string;
  readonly options: readonly OptionTri[];
  readonly valeur: string;
  readonly onChangeValeur: (valeur: string) => void;
  /** Nom accessible ET infobulle du bouton (déjà traduit). */
  readonly label: string;
  readonly className?: string;
}

/**
 * Tri d'une liste : un bouton icône (comme sur une boutique en ligne) qui ouvre un petit menu
 * Radix. Pas de libellé visible ni de grand déroulant : le nom vit dans `aria-label` et `title`,
 * l'option active est cochée dans le menu. Même hauteur (44 px) que les champs voisins.
 */
export function SelecteurTri({
  id,
  options,
  valeur,
  onChangeValeur,
  label,
  className,
}: ProprietesSelecteurTri) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          size="icon"
          aria-label={label}
          title={label}
          className={cn('shrink-0', className)}
        >
          <ArrowUpDown aria-hidden className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.valeur}
            checked={option.valeur === valeur}
            onSelect={() => onChangeValeur(option.valeur)}
          >
            {option.valeur === valeur ? (
              <Check aria-hidden className="absolute left-2 h-4 w-4" />
            ) : null}
            {option.libelle}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
