import { useEffect, useId, useState, type FocusEvent } from 'react';

import type { DeviseFacturation } from '@dfa/shared';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formaterMontant } from '@/lib/formats';
import { cn } from '@/lib/utils';

export interface ProprietesChampMontant {
  readonly id?: string;
  /** Centimes entiers, `null` si vide/invalide. Jamais un flottant en francs (CONTRIBUTING.md). */
  readonly valeurCentimes: number | null;
  /** N'émet **jamais** autre chose qu'un entier de centimes ou `null` — jamais un flottant,
   *  jamais une chaîne partielle (voir docs/plan-lot1-frontend-execution.md, F1-U6 « Done »). */
  readonly onChangeCentimes: (centimes: number | null) => void;
  readonly label: string;
  readonly placeholder?: string;
  readonly obligatoire?: boolean;
  readonly disabled?: boolean;
  readonly erreur?: string;
  readonly className?: string;
  /** Devise affichée en préfixe du champ (`CHF` par défaut). Ce champ sert très majoritairement
   *  des saisies qui n'ont structurellement PAS de devise propre — remise, taux horaire, prix
   *  d'article, montant de reprise véhicule : tout ce que le tenant paramètre ou encaisse
   *  aujourd'hui n'existe qu'en CHF (aucun de ces domaines ne porte de colonne `devise`). Un seul
   *  appelant connu a une vraie devise de document à respecter : la remise globale d'un
   *  `document_vente` (`EcranFicheFacture.tsx`), qui passe explicitement `document_.devise` — sans
   *  ce prop, une remise saisie sur une facture EUR reprise afficherait un préfixe CHF trompeur. */
  readonly devise?: DeviseFacturation;
}

/** "12.5" / "12,5" (saisie suisse, virgule ou point) -> 1250 centimes. `null` si non
 *  interprétable comme un montant. */
function analyserCentimes(saisie: string): number | null {
  const normalisee = saisie.trim().replace(',', '.');
  if (normalisee === '') return null;
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalisee)) return null;
  const francs = Number.parseFloat(normalisee);
  if (!Number.isFinite(francs)) return null;
  return Math.round(francs * 100);
}

/** Champ de saisie d'un montant, en francs à l'écran mais qui n'émet que des CENTIMES entiers
 *  (`onChangeCentimes`). Accepte virgule ou point comme séparateur décimal ; toute saisie non
 *  interprétable comme un nombre remonte `null`, jamais une valeur devinée. */
export function ChampMontant({
  id,
  valeurCentimes,
  onChangeCentimes,
  label,
  placeholder,
  obligatoire,
  disabled,
  erreur,
  className,
  devise = 'CHF',
}: ProprietesChampMontant) {
  const idGenere = useId();
  const idChamp = id ?? idGenere;
  const idErreur = `${idChamp}-erreur`;

  const [saisie, setSaisie] = useState(() =>
    valeurCentimes === null ? '' : (valeurCentimes / 100).toFixed(2),
  );

  // Resynchronise depuis l'extérieur (ex. réinitialisation de formulaire/filtres) — jamais
  // pendant une frappe normale, puisque le centimes recalculé à partir de `saisie` correspond
  // alors déjà à `valeurCentimes` (boucle onChangeCentimes -> prop) et ne déclenche rien.
  useEffect(() => {
    if (analyserCentimes(saisie) !== valeurCentimes) {
      setSaisie(valeurCentimes === null ? '' : (valeurCentimes / 100).toFixed(2));
    }
  }, [valeurCentimes]);

  const gererChangement = (valeur: string) => {
    setSaisie(valeur);
    onChangeCentimes(analyserCentimes(valeur));
  };

  const gererPerteFocus = (_evenement: FocusEvent<HTMLInputElement>) => {
    // Reformate proprement à la perte de focus si la saisie a produit un montant valide,
    // sans jamais réinterpréter/deviner une saisie invalide (elle reste affichée telle quelle
    // pour que l'utilisateur voie ce qu'il faut corriger).
    const centimes = analyserCentimes(saisie);
    if (centimes !== null) {
      setSaisie((centimes / 100).toFixed(2));
    }
  };

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={idChamp}>
        {label}
        {obligatoire ? ' *' : ''}
      </Label>
      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 texte-libelle text-muted-foreground">
          {devise}
        </span>
        <Input
          id={idChamp}
          type="text"
          inputMode="decimal"
          className="pl-11 text-right tabular-nums"
          placeholder={placeholder ?? '0.00'}
          value={saisie}
          disabled={disabled}
          aria-invalid={erreur ? true : undefined}
          aria-describedby={erreur ? idErreur : undefined}
          onChange={(evenement) => gererChangement(evenement.target.value)}
          onBlur={gererPerteFocus}
        />
      </div>
      {valeurCentimes !== null && !erreur ? (
        <p className="texte-libelle texte-montant text-muted-foreground">
          {formaterMontant(valeurCentimes)}
        </p>
      ) : null}
      {erreur ? (
        <p id={idErreur} className="texte-libelle text-destructive">
          {erreur}
        </p>
      ) : null}
    </div>
  );
}
