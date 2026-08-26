import {
  forwardRef,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { Input } from '@/components/ui/input';
import { PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Mécanique COMMUNE à toute combobox accessible de saisie-avec-suggestions du produit : champ +
 * popover de suggestions, navigation clavier (haut/bas/Home/End/Entrée/Échap), sélection
 * uniquement sur choix explicite, accessibilité ARIA `combobox`/`listbox`/`option`.
 *
 * Factorisé depuis deux implémentations jumelles qui avaient divergé pendant que l'une était sur
 * une branche non fusionnée (`composants/vehicules/ChampAutocompletionVehicule` et
 * `ecrans/atelier/SelecteurArticlePiece`) — dette technique n°4.
 *
 * Ce que ce module NE fait PAS, délibérément — reste toujours chez l'appelant :
 * - la source des suggestions (aucune requête, aucun filtrage, aucun debounce ici) ;
 * - le rendu du CONTENU d'une suggestion (une marque de véhicule et un article de stock n'ont
 *   rien de commun à afficher : disponibilité/prix pour l'un, identité pour l'autre) ;
 * - tout libellé/message (chargement, erreur, aucun résultat, aide) : zéro chaîne en dur ici —
 *   l'appelant compose `PopoverContenuCombobox` avec son propre contenu par état ;
 * - toute politique métier (repli "hors référentiel", refus stable 403/404, réessai, saisie
 *   manuelle toujours possible).
 *
 * Écrit à la main plutôt qu'avec `cmdk` (`components/ui/command.tsx`) : `CommandInput` fixe
 * `aria-expanded="true"` en dur, indépendamment de l'ouverture réelle de la liste (vérifié dans
 * le paquet installé, cmdk 1.1.1) — correct pour un panneau de résultats toujours monté, mais
 * faux pour une liste qui s'ouvre/ferme réellement comme ici : un lecteur d'écran annoncerait la
 * liste "dépliée" en permanence, y compris fermée.
 */

export interface ComboboxAccessible<TOption> {
  readonly ouvert: boolean;
  readonly setOuvert: (ouvert: boolean) => void;
  readonly indexActif: number;
  readonly idListe: string;
  /** `undefined` quand aucune suggestion n'est active — jamais une chaîne vide. */
  readonly idActif: string | undefined;
  readonly idOption: (index: number) => string;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  /** À composer dans le `onChange` de l'appelant, APRÈS la mise à jour de la valeur/saisie :
   *  rouvre la liste et désarme la sélection active (une frappe ne doit jamais laisser une
   *  suggestion de la frappe précédente visuellement "active"). */
  readonly gererSaisie: () => void;
  /** À composer dans le `onFocus` de l'appelant. */
  readonly gererFocus: () => void;
  /** À composer dans le `onBlur` de l'appelant. */
  readonly gererPerteFocus: () => void;
  readonly gererClavier: (evenement: KeyboardEvent<HTMLInputElement>) => void;
  /** Sélection explicite (clic sur une option, ou Entrée via `gererClavier`) : appelle
   *  `onChoisir` fourni par l'appelant PUIS referme la liste, désarme la sélection active et
   *  rend le focus au champ — protocole identique quelle que soit la source du choix. */
  readonly choisir: (option: TOption) => void;
}

export function useComboboxAccessible<TOption>(parametres: {
  readonly options: readonly TOption[];
  /** Appelé UNIQUEMENT sur un choix explicite — jamais sur une simple frappe. Ne doit contenir
   *  que l'effet métier (mise à jour de la valeur/saisie, callback vers l'appelant) : la
   *  fermeture/le réarmement/le focus sont déjà gérés par `choisir` ci-dessous. */
  readonly onChoisir: (option: TOption) => void;
}): ComboboxAccessible<TOption> {
  const { options, onChoisir } = parametres;
  const idBase = useId();
  const idListe = `${idBase}-listbox`;
  const idOption = (index: number) => `${idBase}-option-${String(index)}`;

  const inputRef = useRef<HTMLInputElement>(null);
  const [ouvert, setOuvert] = useState(false);
  const [indexActif, setIndexActif] = useState(-1);

  function choisir(option: TOption) {
    onChoisir(option);
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
        // saisie libre : Entrée sans sélection active ne fait rien de spécial ici (soumission
        // normale du formulaire englobant).
        if (!ouvert || indexActif < 0) return;
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

  return {
    ouvert,
    setOuvert,
    indexActif,
    idListe,
    idActif: indexActif >= 0 ? idOption(indexActif) : undefined,
    idOption,
    inputRef,
    gererSaisie: () => {
      setOuvert(true);
      setIndexActif(-1);
    },
    gererFocus: () => setOuvert(true),
    gererPerteFocus: () => setOuvert(false),
    gererClavier,
    choisir,
  };
}

export interface ProprietesChampCombobox extends Pick<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'onFocus' | 'onBlur' | 'onKeyDown' | 'placeholder' | 'disabled'
> {
  readonly id: string;
  /** Nom ARIA de la combobox — voir `ComboboxAccessible.spec.tsx` et les composants appelants
   *  pour la doctrine sur la redondance avec un `<Label>` externe. */
  readonly ariaLabel: string;
  readonly ouvert: boolean;
  readonly idListe: string;
  readonly idActif: string | undefined;
  readonly ariaInvalid?: boolean;
}

/** Le champ de saisie proprement dit, ancré au `Popover` englobant (voir `PopoverContenuCombobox`
 *  — les deux doivent partager le même `<Popover>` racine ouvert par l'appelant). Porte tous les
 *  attributs ARIA `combobox` fixes ; `value`/`onChange`/`onFocus`/`onBlur` restent fournis par
 *  l'appelant (composés avec `gererSaisie`/`gererFocus`/`gererPerteFocus` du hook), car c'est là
 *  que vit la différence métier (mise à jour d'une valeur de formulaire vs d'une saisie de
 *  recherche séparée). */
export const ChampCombobox = forwardRef<HTMLInputElement, ProprietesChampCombobox>(
  ({ id, ariaLabel, ouvert, idListe, idActif, ariaInvalid, ...proprietesChamp }, ref) => (
    <PopoverAnchor asChild>
      <Input
        ref={ref}
        id={id}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={ouvert}
        aria-controls={idListe}
        aria-autocomplete="list"
        aria-activedescendant={idActif}
        aria-invalid={ariaInvalid ? true : undefined}
        autoComplete="off"
        {...proprietesChamp}
      />
    </PopoverAnchor>
  ),
);
ChampCombobox.displayName = 'ChampCombobox';

export interface ProprietesPopoverContenuCombobox {
  readonly className?: string;
  readonly children: ReactNode;
}

/** Le panneau flottant de suggestions. Le CONTENU (états chargement/erreur/vide/liste) est
 *  entièrement fourni par l'appelant en `children` — ce composant ne porte que le positionnement
 *  et les correctifs de focus/clic-extérieur communs aux deux usages d'origine. */
export function PopoverContenuCombobox({ className, children }: ProprietesPopoverContenuCombobox) {
  return (
    <PopoverContent
      align="start"
      sideOffset={4}
      // Le focus ne doit JAMAIS quitter le champ de saisie — ni à l'ouverture ni à la fermeture
      // de la liste — sinon chaque suggestion affichée déplacerait le curseur du garagiste hors
      // du champ qu'il est en train de remplir.
      onOpenAutoFocus={(evenement) => evenement.preventDefault()}
      onCloseAutoFocus={(evenement) => evenement.preventDefault()}
      // Défaut corrigé (constaté au navigateur, pas seulement en test) : `PopoverAnchor` n'est
      // PAS exclu de la détection « clic extérieur » de Radix (contrairement à
      // `PopoverTrigger`) — sur un focus qui ouvre la liste SANS frappe ensuite, le
      // `pointerdown` qui donne le focus au champ est lui-même capté comme « extérieur au
      // contenu » (pas encore monté au moment du `pointerdown`) et referme la liste dans la
      // foulée. Ce composant gère DÉJÀ la fermeture lui-même de façon exhaustive (`onBlur`,
      // Échap, sélection) : la détection « extérieure » de Radix est redondante, jamais la seule
      // protection — la désactiver élimine la course sans rien perdre.
      onPointerDownOutside={(evenement) => evenement.preventDefault()}
      onFocusOutside={(evenement) => evenement.preventDefault()}
      className={cn('w-[var(--radix-popover-trigger-width)] p-1', className)}
    >
      {children}
    </PopoverContent>
  );
}

export interface ProprietesListeOptionsCombobox {
  readonly id: string;
  readonly ariaLabel: string;
  readonly className?: string;
  readonly children: ReactNode;
}

export function ListeOptionsCombobox({
  id,
  ariaLabel,
  className,
  children,
}: ProprietesListeOptionsCombobox) {
  return (
    <ul
      id={id}
      role="listbox"
      aria-label={ariaLabel}
      className={cn('flex flex-col gap-0.5', className)}
    >
      {children}
    </ul>
  );
}

export interface ProprietesOptionCombobox {
  readonly id: string;
  readonly actif: boolean;
  readonly onClick: () => void;
  /** Mise en page propre à chaque appelant (une ligne "marque + complément" n'a pas la même
   *  forme qu'une carte "désignation + prix + référence + disponibilité") — fusionnée avec les
   *  classes communes (curseur, interlignage, état actif), jamais remplacée. */
  readonly className?: string;
  readonly children: ReactNode;
}

export function OptionCombobox({
  id,
  actif,
  onClick,
  className,
  children,
}: ProprietesOptionCombobox) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={actif}
      // `data-highlighted` (pas `bg-accent`/`text-accent-foreground` posés à la main, défaut
      // corrigé refonte visuelle) : `.element-menu[data-highlighted]` (index.css) est LE mécanisme
      // partagé de surlignage de menu du produit (Radix/cmdk le posent eux-mêmes) — il apporte,
      // en plus de la teinte de marque douce, l'anneau intérieur WCAG 1.4.11 (3:1) que `bg-accent`
      // seul ne tient pas ici (`--accent` ≈ `--card`, ~1.1:1). Cette option ne reçoit jamais le
      // focus DOM réel (`aria-activedescendant` sur le champ, voir `ChampCombobox`) : `outline-none`
      // au repos est donc inerte, pas un focus perdu — même contrat que documenté en tête
      // d'index.css pour `.anneau-focus`.
      data-highlighted={actif ? '' : undefined}
      // `onMouseDown`+`preventDefault` : empêche le `blur` du champ de se déclencher AVANT le
      // `onClick` de l'option — sinon la liste se ferme (voir `gererPerteFocus`) avant même que
      // la sélection ne soit prise en compte.
      onMouseDown={(evenement) => evenement.preventDefault()}
      onClick={onClick}
      className={cn(
        'element-menu cursor-pointer select-none rounded-sm px-2 py-2 outline-none',
        className,
      )}
    >
      {children}
    </li>
  );
}

/** Annonce ARIA seule (`role="status"`, `aria-live="polite"`, invisible) — le texte VISIBLE
 *  équivalent vit dans `PopoverContenuCombobox` : pas de troisième copie statique, qui ne ferait
 *  que dupliquer ce que le popover affiche déjà dès qu'il s'ouvre. */
export function AnnonceLiveCombobox({ children }: { readonly children: ReactNode }) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {children}
    </span>
  );
}
