import { useId } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export interface ProprietesChampTelephone {
  readonly id?: string;
  /** Saisie brute — la normalisation E.164 est faite par le serveur (contrat
   *  `schemaTelephoneE164`, @dfa/shared) : ce champ ne réimplémente aucune validation de
   *  format, il transmet ce que l'utilisateur a tapé. */
  readonly valeur: string;
  readonly onChangeValeur: (valeur: string) => void;
  readonly label: string;
  readonly placeholder?: string;
  readonly obligatoire?: boolean;
  readonly disabled?: boolean;
  readonly erreur?: string;
  readonly className?: string;
}

/** Champ de saisie d'un numéro de téléphone. Aucune validation/normalisation cliente : la
 *  saisie brute part telle quelle, le serveur normalise en E.164. */
export function ChampTelephone({
  id,
  valeur,
  onChangeValeur,
  label,
  placeholder,
  obligatoire,
  disabled,
  erreur,
  className,
}: ProprietesChampTelephone) {
  const idGenere = useId();
  const idChamp = id ?? idGenere;
  const idErreur = `${idChamp}-erreur`;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={idChamp}>
        {label}
        {obligatoire ? ' *' : ''}
      </Label>
      <Input
        id={idChamp}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder={placeholder ?? '+41 79 000 00 00'}
        value={valeur}
        disabled={disabled}
        aria-invalid={erreur ? true : undefined}
        aria-describedby={erreur ? idErreur : undefined}
        onChange={(evenement) => onChangeValeur(evenement.target.value)}
      />
      {erreur ? (
        <p id={idErreur} className="texte-libelle text-destructive">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
