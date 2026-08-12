import { Info } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import {
  estValeurDansReferentiel,
  type OptionAutocompletionVehicule,
} from '@/hooks/vehicules/autocompletion-vehicule';
import { cn } from '@/lib/utils';

export type { OptionAutocompletionVehicule };

export interface ProprietesChampAutocompletionVehicule {
  readonly id: string;
  /** Nom du champ pour `aria-label` de la liste flottante (le `<Label htmlFor>` externe reste la
   *  source d'accessibilité normale du champ lui-même — ce libellé sert uniquement à nommer le
   *  `role="listbox"` séparé). */
  readonly libelle: string;
  readonly valeur: string;
  readonly onValeurChange: (valeur: string) => void;
  /** Suggestions déjà résolues par l'appelant (recherche serveur, tri, limite) — ce composant ne
   *  fait aucune requête et ne filtre rien lui-même : voir `hooks/vehicules/useValeurDebouncee`
   *  et la couche transport pour la temporisation/l'annulation des requêtes obsolètes. */
  readonly options: readonly OptionAutocompletionVehicule[];
  readonly enChargement: boolean;
  /** Message déjà traduit si la RECHERCHE de suggestions a échoué (panne réseau/serveur) — jamais
   *  confondu avec « aucune correspondance » (état normal, pas une panne). N'empêche JAMAIS la
   *  saisie libre : une panne de l'autocomplétion ne doit jamais bloquer le garagiste qui tape sa
   *  propre valeur (même doctrine que le repli manuel lui-même). */
  readonly erreur?: string | null;
  /** Appelé UNIQUEMENT sur un choix explicite (clic ou Entrée sur une suggestion) — jamais sur une
   *  simple frappe. Sert par exemple à réinitialiser le champ modèle quand la marque change
   *  vraiment, sans piéger un garagiste qui corrige juste une faute de frappe (CONTRIBUTING.md / besoin
   *  @laupernoe : la réinitialisation sur chaque frappe serait un piège, pas une aide). */
  readonly onSelectionOption?: (option: OptionAutocompletionVehicule) => void;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly ariaInvalid?: boolean;
  readonly className?: string;
}

/**
 * Champ marque/modèle : saisie libre TOUJOURS possible (le texte tapé est directement la valeur
 * du formulaire, jamais un état "brouillon" distinct d'une valeur "confirmée"), avec une liste de
 * suggestions qui s'ouvre au focus/à la frappe. Le repli manuel n'est pas un cas d'erreur caché
 * derrière une option "autre" : il n'existe littéralement pas de distinction entre "j'ai choisi
 * une suggestion" et "j'ai tapé ma propre valeur", les deux écrivent le même champ.
 *
 * Construit SANS `cmdk` (`components/ui/command.tsx`) malgré l'existence de ce composant dans le
 * dépôt : `CommandInput` fixe `aria-expanded="true"` en dur, indépendamment de l'ouverture réelle
 * de la liste (vérifié dans le paquet installé, cmdk 1.1.1) — correct pour un panneau de résultats
 * toujours monté (voir `PanneauResultatsRecherche.tsx`), mais faux pour une liste qui
 * s'ouvre/ferme réellement comme ici : un lecteur d'écran annoncerait la liste "dépliée" en
 * permanence, y compris fermée. La combobox ci-dessous est donc écrite à la main (rôles/attributs
 * ARIA `combobox`/`listbox`/`option` standard, navigation clavier complète), en réutilisant
 * `Popover` (positionnement flottant) pour ne pas réinventer CETTE partie-là.
 */
export function ChampAutocompletionVehicule({
  id,
  libelle,
  valeur,
  onValeurChange,
  options,
  enChargement,
  erreur,
  onSelectionOption,
  placeholder,
  disabled,
  ariaInvalid,
  className,
}: ProprietesChampAutocompletionVehicule) {
  const { t } = useTranslation('vehicules');
  const idBase = useId();
  const idListe = `${idBase}-listbox`;
  const idOption = (index: number) => `${idBase}-option-${String(index)}`;

  const inputRef = useRef<HTMLInputElement>(null);
  const [ouvert, setOuvert] = useState(false);
  const [indexActif, setIndexActif] = useState(-1);
  // Le repli "hors référentiel" ne s'affiche qu'une fois la saisie terminée (perte de focus) —
  // pas à chaque frappe, sinon le message clignoterait sur toute marque en cours de complétion
  // ("Merc" serait annoncé hors référentiel juste avant que "Mercedes-Benz" ne soit tapé en
  // entier). Réarmé au focus suivant.
  const [saisieTerminee, setSaisieTerminee] = useState(false);

  function choisir(option: OptionAutocompletionVehicule) {
    onValeurChange(option.valeur);
    onSelectionOption?.(option);
    setOuvert(false);
    setIndexActif(-1);
    inputRef.current?.focus();
  }

  function gererClavier(evenement: KeyboardEvent<HTMLInputElement>) {
    switch (evenement.key) {
      case 'ArrowDown': {
        if (options.length === 0) return;
        evenement.preventDefault();
        setOuvert(true);
        setIndexActif((index) => Math.min(index + 1, options.length - 1));
        return;
      }
      case 'ArrowUp': {
        if (options.length === 0) return;
        evenement.preventDefault();
        setOuvert(true);
        setIndexActif((index) => Math.max(index - 1, 0));
        return;
      }
      case 'Home': {
        if (!ouvert || options.length === 0) return;
        evenement.preventDefault();
        setIndexActif(0);
        return;
      }
      case 'End': {
        if (!ouvert || options.length === 0) return;
        evenement.preventDefault();
        setIndexActif(options.length - 1);
        return;
      }
      case 'Enter': {
        if (!ouvert || indexActif < 0) return; // saisie libre : Entrée sans sélection ne fait rien de spécial ici (soumission normale du formulaire englobant).
        const option = options[indexActif];
        if (!option) return;
        evenement.preventDefault();
        choisir(option);
        return;
      }
      case 'Escape': {
        if (!ouvert) return;
        evenement.preventDefault();
        evenement.stopPropagation();
        setOuvert(false);
        setIndexActif(-1);
        return;
      }
      default:
        return;
    }
  }

  const dansReferentiel = estValeurDansReferentiel(valeur, options);
  // Une panne de la recherche de suggestions ne prouve RIEN sur la saisie elle-même : ne jamais
  // l'étiqueter "hors référentiel" faute de réponse, ce serait mentir sur ce qu'on sait vraiment.
  const afficherHorsReferentiel =
    saisieTerminee && !enChargement && !erreur && valeur.trim() !== '' && !dansReferentiel;

  let annonceLive = '';
  if (ouvert) {
    if (enChargement) {
      annonceLive = t('identite.autocompletion.recherche');
    } else if (erreur) {
      annonceLive = erreur;
    } else if (options.length === 0) {
      annonceLive = t('identite.autocompletion.aucunResultat');
    } else {
      annonceLive = t('identite.autocompletion.resultats', { count: options.length });
    }
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Popover open={ouvert} onOpenChange={setOuvert}>
        <PopoverAnchor asChild>
          <Input
            ref={inputRef}
            id={id}
            role="combobox"
            // `aria-label` redondant avec le `<Label htmlFor={id}>` externe (même texte que
            // `libelle`, voir intégration dans l'écran) — pas un conflit : les deux portent le
            // même nom. Nécessaire pour que CE composant reste nommé de façon autonome (tests
            // isolés, futurs appelants qui oublieraient le `<Label>` externe).
            aria-label={libelle}
            aria-expanded={ouvert}
            aria-controls={idListe}
            aria-autocomplete="list"
            aria-activedescendant={indexActif >= 0 ? idOption(indexActif) : undefined}
            aria-invalid={ariaInvalid ? true : undefined}
            autoComplete="off"
            value={valeur}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(evenement) => {
              onValeurChange(evenement.target.value);
              setOuvert(true);
              setIndexActif(-1);
            }}
            onFocus={() => {
              setOuvert(true);
              setSaisieTerminee(false);
            }}
            onBlur={() => {
              setOuvert(false);
              setSaisieTerminee(true);
            }}
            onKeyDown={gererClavier}
          />
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={4}
          // Le focus ne doit JAMAIS quitter le champ de saisie — ni à l'ouverture ni à la
          // fermeture de la liste — sinon chaque suggestion affichée déplacerait le curseur du
          // garagiste hors du champ qu'il est en train de remplir.
          onOpenAutoFocus={(evenement) => evenement.preventDefault()}
          onCloseAutoFocus={(evenement) => evenement.preventDefault()}
          // Défaut corrigé (constaté au navigateur, pas seulement en test) : `PopoverAnchor` n'est
          // PAS exclu de la détection « clic extérieur » de Radix (contrairement à
          // `PopoverTrigger`) — sur un focus qui ouvre la liste SANS frappe ensuite (ex. cascade
          // marque → modèle, ouverture par simple clic), le `pointerdown` qui donne le focus au
          // champ est lui-même capté comme « extérieur au contenu » (pas encore monté au moment du
          // `pointerdown`) et referme la liste dans la foulée — invisible dès qu'une frappe suit
          // (chaque `onChange` la rouvre), mais bloquant sur un simple focus. Ce composant gère
          // DÉJÀ la fermeture lui-même de façon exhaustive (`onBlur`, `Échap`, sélection) : la
          // détection « extérieure » de Radix est redondante, jamais la seule protection — la
          // désactiver élimine la course sans rien perdre.
          onPointerDownOutside={(evenement) => evenement.preventDefault()}
          onFocusOutside={(evenement) => evenement.preventDefault()}
          className="w-[var(--radix-popover-trigger-width)] p-1"
        >
          {enChargement ? (
            <p className="px-2 py-3 text-center texte-corps text-muted-foreground">
              {t('identite.autocompletion.recherche')}
            </p>
          ) : erreur ? (
            <p className="px-2 py-3 text-center texte-corps text-muted-foreground">{erreur}</p>
          ) : options.length === 0 ? (
            <p className="px-2 py-3 text-center texte-corps text-muted-foreground">
              {t('identite.autocompletion.aucunResultat')}
            </p>
          ) : (
            <ul id={idListe} role="listbox" aria-label={libelle} className="flex flex-col gap-0.5">
              {options.map((option, index) => (
                <li
                  key={option.valeur}
                  id={idOption(index)}
                  role="option"
                  aria-selected={index === indexActif}
                  // `onMouseDown`+`preventDefault` : empêche le `blur` du champ de se déclencher
                  // AVANT le `onClick` de l'option — sinon la liste se ferme (voir `onBlur`
                  // ci-dessus) avant même que la sélection ne soit prise en compte.
                  onMouseDown={(evenement) => evenement.preventDefault()}
                  onClick={() => choisir(option)}
                  className={cn(
                    'element-menu flex min-h-11 cursor-pointer select-none items-center justify-between gap-3 rounded-sm px-2 py-2 texte-corps outline-none',
                    index === indexActif ? 'bg-accent text-accent-foreground' : undefined,
                  )}
                >
                  <span>{option.valeur}</span>
                  {option.complement ? (
                    <span className="texte-libelle text-muted-foreground">{option.complement}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </PopoverContent>
      </Popover>

      <span role="status" aria-live="polite" className="sr-only">
        {annonceLive}
      </span>

      {afficherHorsReferentiel ? (
        <p className="flex items-center gap-1.5 texte-libelle text-muted-foreground">
          <Info aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          {t('identite.autocompletion.horsReferentiel')}
        </p>
      ) : null}
    </div>
  );
}
