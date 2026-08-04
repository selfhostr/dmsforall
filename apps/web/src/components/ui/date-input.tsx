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

import { cn } from '@/lib/utils';
import { dateVersFormatSuisse, formatSuisseVersISO, isoDirectValide } from '@/lib/formats';

export interface DateInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'onChange' | 'onBlur'
> {
  /**
   * Valeur ISO (aaaa-mm-jj), ou `null`/`undefined` si vide. JAMAIS un objet `Date` ni une chaîne
   * suisse — contrat d'entrée/sortie unique et symétrique (toujours ISO), à la différence de
   * l'ancienne version qui acceptait `Date` en entrée et détectait deux « modes » d'`onChange »
   * (event React vs callback direct) selon l'appelant. C'est précisément ce double mode qui
   * cassait react-hook-form : `register()` ne peut pas être branché sur ce contrat, les écrans
   * appelants passent désormais par `<Controller>` (voir les écrans `ventes/stock`,
   * `parametrage/DialogueTauxHoraire`, `vehicules/EcranNouveauVehicule`).
   */
  readonly value?: string | null;
  /** `undefined` si le champ est vide OU si la saisie ne correspond à aucune date valide (suisse
   *  jj.mm.aaaa ou ISO aaaa-mm-jj direct) — jamais un event React, jamais une chaîne partielle. */
  readonly onChange?: (valeurISO: string | undefined) => void;
  readonly onBlur?: (evenement: FocusEvent<HTMLInputElement>) => void;
  /** Message d'erreur porté par l'appelant (ex. « champ requis » via react-hook-form) —
   *  prioritaire sur le message interne « format invalide » (même patron que `ChampMontant`,
   *  `composants/comptoir/ChampMontant.tsx`). */
  readonly erreur?: string;
}

/** Interprète la saisie utilisateur (texte libre du champ) comme une date : accepte le format
 *  suisse jj.mm.aaaa (cas normal, `formatSuisseVersISO`) OU une chaîne ISO aaaa-mm-jj tapée,
 *  collée ou déposée par le remplissage automatique du navigateur (`isoDirectValide`) —
 *  `undefined` si ni l'un ni l'autre ne correspond à une date qui existe réellement. */
function parserSaisieDate(saisie: string): string | undefined {
  return formatSuisseVersISO(saisie) ?? isoDirectValide(saisie);
}

/**
 * Champ de saisie de date au format suisse (jj.mm.aaaa) — jamais `<input type="date">`, qui suit
 * la locale du NAVIGATEUR (mm/dd/yyyy en anglais US) et non celle du garage : en test réel, une
 * date du 4 août s'affichait « 08/04/2026 », lue « 8 avril » par un garagiste. Erreur réelle sur
 * des documents qui engagent (mise en circulation, période de taux horaire, entrée en stock), pas
 * du cosmétique.
 *
 * Ce composant vit dans `components/ui/` (primitives shadcn/ui génériques, documentées comme
 * « anglais » dans la cartographie du dépôt), mais reste intrinsèquement suisse par construction
 * (le formateur `de-CH` est figé dans `lib/formats.ts`, jamais dérivé de la langue d'interface) —
 * le message d'erreur interne passe donc par i18n (`validation:dateInvalide`) plutôt qu'un texte
 * anglais en dur : la règle « aucune chaîne en dur » (CONTRIBUTING.md) prime sur la convention
 * « générique/anglais » de ce dossier pour ce composant précis.
 *
 * UN SEUL `<input>` DOM (`type="text"`) — l'ancienne version rendait un Fragment à deux `<input>`
 * (un visible + un `type="hidden"` portant l'ISO), synchronisés par ref : incompatible avec
 * react-hook-form (`register()` écrit sur le mauvais input, la valeur ISO n'atteignait jamais le
 * formulaire). Composant CONTRÔLÉ, calqué sur `ChampMontant` : état local pour le texte affiché/en
 * cours de frappe (l'utilisateur doit pouvoir taper "0" puis "04" puis "04." sans que chaque
 * frappe intermédiaire soit rejetée), resynchronisé depuis la prop `value` uniquement quand elle
 * diverge réellement de ce que la saisie courante représente déjà — même garde-fou anti-boucle que
 * `ChampMontant` (`analyserCentimes(saisie) !== valeurCentimes` dans un `useEffect([valeurCentimes])`).
 */
export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(
  (
    {
      className,
      value,
      onChange,
      onBlur,
      erreur,
      id,
      placeholder = 'jj.mm.aaaa',
      'aria-invalid': ariaInvalidExterne,
      ...props
    },
    ref,
  ) => {
    const { t } = useTranslation('validation');
    const idGenere = useId();
    const idChamp = id ?? idGenere;
    const idErreur = `${idChamp}-erreur`;

    const [saisie, setSaisie] = useState(() => dateVersFormatSuisse(value ?? undefined));
    const [touche, setTouche] = useState(false);

    // Resynchronise depuis l'extérieur (valeur initiale d'un formulaire d'édition, `form.reset()`,
    // remplissage automatique du navigateur) — jamais pendant une frappe normale, puisque l'ISO
    // recalculé à partir de `saisie` correspond alors déjà à `value` (boucle onChange -> prop) et
    // ne déclenche rien.
    useEffect(() => {
      if (parserSaisieDate(saisie) !== (value ?? undefined)) {
        setSaisie(dateVersFormatSuisse(value ?? undefined));
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- resync pilotée par `value` seul,
      // volontairement (voir commentaire ci-dessus, même patron que ChampMontant).
    }, [value]);

    const gererChangement = (evenement: ChangeEvent<HTMLInputElement>) => {
      const nouvelleSaisie = evenement.target.value;
      setSaisie(nouvelleSaisie);
      onChange?.(parserSaisieDate(nouvelleSaisie));
    };

    const gererPerteFocus = (evenement: FocusEvent<HTMLInputElement>) => {
      setTouche(true);
      onBlur?.(evenement);
    };

    const invalideInterne =
      touche && saisie.trim() !== '' && parserSaisieDate(saisie) === undefined;
    const ariaInvalideExterneVrai = ariaInvalidExterne === true || ariaInvalidExterne === 'true';
    const ariaInvalide = ariaInvalideExterneVrai || invalideInterne ? true : ariaInvalidExterne;
    const messageErreurAffiche = erreur ?? (invalideInterne ? t('dateInvalide') : undefined);

    return (
      <>
        <input
          ref={ref}
          id={idChamp}
          type="text"
          inputMode="numeric"
          className={cn(
            'flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base',
            'placeholder:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          placeholder={placeholder}
          value={saisie}
          onChange={gererChangement}
          onBlur={gererPerteFocus}
          aria-invalid={ariaInvalide}
          aria-describedby={messageErreurAffiche ? idErreur : undefined}
          {...props}
        />
        {messageErreurAffiche ? (
          <p id={idErreur} className="texte-libelle text-destructive">
            {messageErreurAffiche}
          </p>
        ) : null}
      </>
    );
  },
);

DateInput.displayName = 'DateInput';
