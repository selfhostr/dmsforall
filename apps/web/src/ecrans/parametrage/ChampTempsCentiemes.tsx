import { useEffect, useId, useState, type FocusEvent } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export interface ProprietesChampTempsCentiemes {
  readonly id?: string;
  /** Centièmes d'heure entiers (`120` = 1,20 h), `null` si vide/invalide — même discipline que
   *  les montants en centimes (`ChampMontant`) : jamais de flottant stocké. */
  readonly valeurCentiemes: number | null;
  readonly onChangeCentiemes: (centiemes: number | null) => void;
  readonly label: string;
  readonly placeholder?: string;
  readonly obligatoire?: boolean;
  readonly disabled?: boolean;
  readonly erreur?: string;
  readonly className?: string;
}

/** "1.2" / "1,2" (saisie suisse) -> 120 centièmes d'heure. `null` si non interprétable. */
function analyserCentiemes(saisie: string): number | null {
  const normalisee = saisie.trim().replace(',', '.');
  if (normalisee === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(normalisee)) return null;
  const heures = Number.parseFloat(normalisee);
  if (!Number.isFinite(heures)) return null;
  return Math.round(heures * 100);
}

/**
 * Champ de saisie d'un temps atelier (barème de prestation, capacité journalière d'un site), en
 * HEURES DÉCIMALES à l'écran mais qui n'émet que des CENTIÈMES D'HEURE entiers — même patron que
 * `composants/comptoir/ChampMontant.tsx` pour les montants. Local à `ecrans/parametrage/` : pas
 * encore assez d'écrans hors de ce périmètre pour justifier sa promotion en composant partagé.
 */
export function ChampTempsCentiemes({
  id,
  valeurCentiemes,
  onChangeCentiemes,
  label,
  placeholder,
  obligatoire,
  disabled,
  erreur,
  className,
}: ProprietesChampTempsCentiemes) {
  const idGenere = useId();
  const idChamp = id ?? idGenere;
  const idErreur = `${idChamp}-erreur`;

  const [saisie, setSaisie] = useState(() =>
    valeurCentiemes === null ? '' : (valeurCentiemes / 100).toFixed(2),
  );

  useEffect(() => {
    if (analyserCentiemes(saisie) !== valeurCentiemes) {
      setSaisie(valeurCentiemes === null ? '' : (valeurCentiemes / 100).toFixed(2));
    }
  }, [valeurCentiemes]);

  const gererChangement = (valeur: string) => {
    setSaisie(valeur);
    onChangeCentiemes(analyserCentiemes(valeur));
  };

  const gererPerteFocus = (_evenement: FocusEvent<HTMLInputElement>) => {
    const centiemes = analyserCentiemes(saisie);
    if (centiemes !== null) {
      setSaisie((centiemes / 100).toFixed(2));
    }
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
          inputMode="decimal"
          className="pr-9 text-right tabular-nums"
          placeholder={placeholder ?? '0.00'}
          value={saisie}
          disabled={disabled}
          aria-invalid={erreur ? true : undefined}
          aria-describedby={erreur ? idErreur : undefined}
          onChange={(evenement) => gererChangement(evenement.target.value)}
          onBlur={gererPerteFocus}
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 texte-libelle text-muted-foreground">
          h
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
