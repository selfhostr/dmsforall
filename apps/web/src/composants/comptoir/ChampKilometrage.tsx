import { useEffect, useId, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { UniteDistance } from '@/lib/formats';
import { cn } from '@/lib/utils';

export interface ProprietesChampKilometrage {
  readonly id?: string;
  readonly valeur: number | null;
  /** N'émet qu'un entier ou `null` — jamais de conversion d'unité ici : mi -> km est fait par
   *  le serveur (CT-08, voir docs/plan-lot1-frontend-execution.md F1-U6 « Done »). */
  readonly onChangeValeur: (valeur: number | null) => void;
  /** Unité de la valeur saisie. **Obligatoire** (CT-08) : jamais de km supposé par défaut. */
  readonly unite: UniteDistance;
  readonly label: string;
  readonly placeholder?: string;
  readonly obligatoire?: boolean;
  readonly disabled?: boolean;
  readonly erreur?: string;
  readonly className?: string;
}

function analyserEntier(saisie: string): number | null {
  const nettoyee = saisie.trim().replace(/[^\d]/g, '');
  if (nettoyee === '') return null;
  const valeur = Number.parseInt(nettoyee, 10);
  return Number.isFinite(valeur) ? valeur : null;
}

/** Champ de saisie d'un kilométrage : entier strict dans l'unité déclarée par `unite`, jamais
 *  de virgule/décimale. L'unité s'affiche en suffixe et n'est jamais recalculée côté client. */
export function ChampKilometrage({
  id,
  valeur,
  onChangeValeur,
  unite,
  label,
  placeholder,
  obligatoire,
  disabled,
  erreur,
  className,
}: ProprietesChampKilometrage) {
  const idGenere = useId();
  const idChamp = id ?? idGenere;
  const idErreur = `${idChamp}-erreur`;

  const [saisie, setSaisie] = useState(() => (valeur === null ? '' : String(valeur)));

  useEffect(() => {
    if (analyserEntier(saisie) !== valeur) {
      setSaisie(valeur === null ? '' : String(valeur));
    }
  }, [valeur]);

  const gererChangement = (nouvelleSaisie: string) => {
    setSaisie(nouvelleSaisie);
    onChangeValeur(analyserEntier(nouvelleSaisie));
  };

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={idChamp}>
        {label}
        {obligatoire ? ' *' : ''}
      </Label>
      <div className="relative">
        <Input
          id={idChamp}
          type="text"
          inputMode="numeric"
          className="pr-11 tabular-nums"
          placeholder={placeholder ?? '0'}
          value={saisie}
          disabled={disabled}
          aria-invalid={erreur ? true : undefined}
          aria-describedby={erreur ? idErreur : undefined}
          onChange={(evenement) => gererChangement(evenement.target.value)}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 texte-libelle text-muted-foreground">
          {unite}
        </span>
      </div>
      {erreur ? (
        <p id={idErreur} className="texte-libelle text-destructive">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
