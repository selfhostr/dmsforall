import { useId } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { normaliserPlaque } from '@/lib/plaque';
import { cn } from '@/lib/utils';

export interface ProprietesChampPlaque {
  readonly id?: string;
  /** Déjà normalisée (`normaliserPlaque`) : majuscules, sans espace ni tiret. */
  readonly valeur: string;
  /** Reçoit systématiquement la valeur normalisée (voir `@/lib/plaque` : « ne servent qu'à
   *  l'affichage et à la préparation de la valeur envoyée telle quelle au serveur »). */
  readonly onChangeValeur: (valeurNormalisee: string) => void;
  readonly label: string;
  readonly placeholder?: string;
  readonly obligatoire?: boolean;
  readonly disabled?: boolean;
  readonly erreur?: string;
  readonly className?: string;
}

/** Champ de saisie d'une plaque suisse (ou étrangère). Normalise en continu (majuscules, sans
 *  espace/tiret/apostrophe) via `@/lib/plaque` — jamais une seconde implémentation de
 *  normalisation ici. La forme d'affichage "VD 123456" reste à `Plaque` (composants/identite),
 *  ce champ est la saisie brute. */
export function ChampPlaque({
  id,
  valeur,
  onChangeValeur,
  label,
  placeholder,
  obligatoire,
  disabled,
  erreur,
  className,
}: ProprietesChampPlaque) {
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
        type="text"
        autoCapitalize="characters"
        className="uppercase tracking-wide"
        placeholder={placeholder ?? 'VD 123456'}
        value={valeur}
        disabled={disabled}
        aria-invalid={erreur ? true : undefined}
        aria-describedby={erreur ? idErreur : undefined}
        onChange={(evenement) => onChangeValeur(normaliserPlaque(evenement.target.value))}
      />
      {erreur ? (
        <p id={idErreur} className="texte-libelle text-destructive">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
