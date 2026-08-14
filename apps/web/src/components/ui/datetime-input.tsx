import {
  forwardRef,
  useEffect,
  useId,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type InputHTMLAttributes,
} from 'react';
import { useTranslation } from 'react-i18next';

import { CLASSES_CHAMP } from '@/components/ui/classes-champ';
import { cn } from '@/lib/utils';
import {
  datetimeVersFormatSuisse,
  formatSuisseVersISO_Datetime,
  isoDatetimeDirectValide,
} from '@/lib/formats';

export interface DatetimeInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'onBlur'
> {
  /**
   * Valeur ISO datetime (aaaa-mm-jjThh:mm:ss.sssZ), ou `null`/`undefined` si vide.
   * JAMAIS un objet `Date` ni une chaîne suisse — contrat d'entrée/sortie unique et symétrique
   * (toujours ISO), à l'instar de `DateInput`.
   */
  readonly value?: string | null;
  /** `undefined` si le champ est vide OU si la saisie ne correspond à aucun horodatage valide
   *  (suisse jj.mm.aaaa HH:MM ou ISO directe) — jamais un event React, jamais une chaîne partielle. */
  readonly onChange?: (valeurISO: string | undefined) => void;
  readonly onBlur?: (evenement: FocusEvent<HTMLInputElement>) => void;
  /** Message d'erreur porté par l'appelant (ex. « champ requis » via react-hook-form) —
   *  prioritaire sur le message interne « format invalide ». */
  readonly erreur?: string;
}

/** Interprète la saisie utilisateur (texte libre du champ) comme un horodatage : accepte le
 *  format suisse jj.mm.aaaa HH:MM (cas normal) OU une chaîne ISO datetime tapée, collée ou
 *  déposée par le remplissage automatique du navigateur (`isoDatetimeDirectValide`) —
 *  `undefined` si ni l'un ni l'autre ne correspond à un horodatage valide. */
function parserSaisieDateTime(saisie: string): string | undefined {
  return formatSuisseVersISO_Datetime(saisie) ?? isoDatetimeDirectValide(saisie);
}

/**
 * Champ de saisie de date + heure au format suisse (jj.mm.aaaa HH:MM) — jamais
 * `<input type="datetime-local">`, qui suit la locale du NAVIGATEUR (mm/dd/yyyy en anglais US)
 * et non celle du garage : en test réel, un horodatage s'affichait en format américain au lieu
 * du format suisse attendu. Erreur réelle sur des documents qui engagent (ORs, tâches planifiées).
 *
 * Ce composant suit exactement le même patron que `DateInput` mais gère les horodatages complets
 * (date + heure) en format suisse.
 */
export const DatetimeInput = forwardRef<HTMLInputElement, DatetimeInputProps>(
  (
    {
      className,
      value,
      onChange,
      onBlur,
      erreur,
      id,
      placeholder = 'jj.mm.aaaa HH:MM',
      'aria-invalid': ariaInvalidExterne,
      ...props
    },
    ref,
  ) => {
    const { t } = useTranslation('validation');
    const idGenere = useId();
    const idChamp = id ?? idGenere;
    const idErreur = `${idChamp}-erreur`;

    const [saisie, setSaisie] = useState(() => datetimeVersFormatSuisse(value ?? undefined));
    const [touche, setTouche] = useState(false);

    // Resynchronise depuis l'extérieur (valeur initiale, form.reset(), remplissage automatique)
    // — jamais pendant une frappe normale, puisque l'ISO recalculé à partir de `saisie`
    // correspond alors déjà à `value`.
    useEffect(() => {
      if (parserSaisieDateTime(saisie) !== (value ?? undefined)) {
        setSaisie(datetimeVersFormatSuisse(value ?? undefined));
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- resync pilotée par `value` seul
    }, [value]);

    const gererChangement = (evenement: ChangeEvent<HTMLInputElement>) => {
      const nouvelleSaisie = evenement.target.value;
      setSaisie(nouvelleSaisie);
      onChange?.(parserSaisieDateTime(nouvelleSaisie));
    };

    const gererPerteFocus = (evenement: FocusEvent<HTMLInputElement>) => {
      setTouche(true);
      onBlur?.(evenement);
    };

    const invalideInterne =
      touche && saisie.trim() !== '' && parserSaisieDateTime(saisie) === undefined;
    const ariaInvalideExterneVrai = ariaInvalidExterne === true || ariaInvalidExterne === 'true';
    const ariaInvalide =
      ariaInvalideExterneVrai || invalideInterne || Boolean(erreur) ? true : ariaInvalidExterne;
    const messageErreurAffiche = erreur ?? (invalideInterne ? t('dateInvalide') : undefined);

    return (
      <>
        <input
          ref={ref}
          id={idChamp}
          type="text"
          inputMode="decimal"
          className={cn(CLASSES_CHAMP, 'h-11', className)}
          placeholder={placeholder}
          value={saisie}
          onChange={gererChangement}
          onBlur={gererPerteFocus}
          aria-invalid={ariaInvalide}
          aria-describedby={messageErreurAffiche ? idErreur : undefined}
          {...props}
        />
        {messageErreurAffiche ? (
          <p id={idErreur} className="text-xs leading-4 text-destructive">
            {messageErreurAffiche}
          </p>
        ) : null}
      </>
    );
  },
);

DatetimeInput.displayName = 'DatetimeInput';
