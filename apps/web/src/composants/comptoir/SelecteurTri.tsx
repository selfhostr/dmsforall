import { useId } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
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
  readonly label: string;
  readonly className?: string;
}

/** Sélecteur de tri compact — alternative aux en-têtes triables de `TableComptoir` (utile en
 *  tablette où la table dense n'est pas le gabarit par défaut). `valeur` suit la forme du
 *  paramètre `tri` de l'API, pas de mapping supplémentaire côté appelant. */
export function SelecteurTri({
  id,
  options,
  valeur,
  onChangeValeur,
  label,
  className,
}: ProprietesSelecteurTri) {
  const idGenere = useId();
  const idChamp = id ?? idGenere;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={idChamp}>{label}</Label>
      <Select value={valeur} onValueChange={onChangeValeur}>
        <SelectTrigger id={idChamp} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.valeur} value={option.valeur}>
              {option.libelle}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
