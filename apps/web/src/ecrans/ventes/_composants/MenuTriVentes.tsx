import { ArrowDownUp, Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface OptionTriVentes {
  /** Forme `<champ>:<asc|desc>`, branchable tel quel sur le paramètre `tri` de l'API. */
  readonly valeur: string;
  /** Déjà traduit par l'appelant. */
  readonly libelle: string;
}

interface Props {
  readonly options: readonly OptionTriVentes[];
  readonly valeur: string;
  readonly onChangeValeur: (valeur: string) => void;
  /** Nom accessible et infobulle du bouton (« Trier par »). */
  readonly label: string;
}

/**
 * Tri des listes de ventes : un bouton icône (comme sur une boutique en ligne) qui ouvre un menu
 * Radix. L'option active porte une coche (forme + texte, pas la couleur seule). Local à `ventes/`
 * en attendant le composant commun de barre de filtres de `fix/epuration-interface`.
 */
export function MenuTriVentes({ options, valeur, onChangeValeur, label }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="icon" aria-label={label} title={label}>
          <ArrowDownUp aria-hidden className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.valeur}
            checked={option.valeur === valeur}
            onCheckedChange={() => onChangeValeur(option.valeur)}
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
