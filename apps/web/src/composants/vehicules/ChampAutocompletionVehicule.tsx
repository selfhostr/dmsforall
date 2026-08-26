import { Info } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Popover } from '@/components/ui/popover';
import {
  AnnonceLiveCombobox,
  ChampCombobox,
  ListeOptionsCombobox,
  OptionCombobox,
  PopoverContenuCombobox,
  useComboboxAccessible,
} from '@/composants/saisie/ComboboxAccessible';
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
   *  fait aucune requête et ne filtre rien lui-même : voir `hooks/commun/useValeurDebouncee`
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
  // Le repli "hors référentiel" ne s'affiche qu'une fois la saisie terminée (perte de focus) —
  // pas à chaque frappe, sinon le message clignoterait sur toute marque en cours de complétion
  // ("Merc" serait annoncé hors référentiel juste avant que "Mercedes-Benz" ne soit tapé en
  // entier). Réarmé au focus suivant.
  const [saisieTerminee, setSaisieTerminee] = useState(false);

  const combobox = useComboboxAccessible<OptionAutocompletionVehicule>({
    options,
    onChoisir: (option) => {
      onValeurChange(option.valeur);
      onSelectionOption?.(option);
    },
  });

  const dansReferentiel = estValeurDansReferentiel(valeur, options);
  // Une panne de la recherche de suggestions ne prouve RIEN sur la saisie elle-même : ne jamais
  // l'étiqueter "hors référentiel" faute de réponse, ce serait mentir sur ce qu'on sait vraiment.
  const afficherHorsReferentiel =
    saisieTerminee && !enChargement && !erreur && valeur.trim() !== '' && !dansReferentiel;

  let annonceLive = '';
  if (combobox.ouvert) {
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
    <div className={cn('flex flex-col gap-champ', className)}>
      <Popover open={combobox.ouvert} onOpenChange={combobox.setOuvert}>
        <ChampCombobox
          ref={combobox.inputRef}
          id={id}
          // `aria-label` redondant avec le `<Label htmlFor={id}>` externe (même texte que
          // `libelle`, voir intégration dans l'écran) — pas un conflit : les deux portent le
          // même nom. Nécessaire pour que CE composant reste nommé de façon autonome (tests
          // isolés, futurs appelants qui oublieraient le `<Label>` externe).
          ariaLabel={libelle}
          ouvert={combobox.ouvert}
          idListe={combobox.idListe}
          idActif={combobox.idActif}
          ariaInvalid={ariaInvalid}
          value={valeur}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(evenement) => {
            onValeurChange(evenement.target.value);
            combobox.gererSaisie();
          }}
          onFocus={() => {
            combobox.gererFocus();
            setSaisieTerminee(false);
          }}
          onBlur={() => {
            combobox.gererPerteFocus();
            setSaisieTerminee(true);
          }}
          onKeyDown={combobox.gererClavier}
        />
        <PopoverContenuCombobox>
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
            <ListeOptionsCombobox id={combobox.idListe} ariaLabel={libelle}>
              {options.map((option, index) => (
                <OptionCombobox
                  key={option.valeur}
                  id={combobox.idOption(index)}
                  actif={index === combobox.indexActif}
                  onClick={() => combobox.choisir(option)}
                  className="flex min-h-11 items-center justify-between gap-3 texte-corps"
                >
                  <span>{option.valeur}</span>
                  {option.complement ? (
                    <span className="texte-libelle text-muted-foreground">{option.complement}</span>
                  ) : null}
                </OptionCombobox>
              ))}
            </ListeOptionsCombobox>
          )}
        </PopoverContenuCombobox>
      </Popover>

      <AnnonceLiveCombobox>{annonceLive}</AnnonceLiveCombobox>

      {afficherHorsReferentiel ? (
        <p className="flex items-center gap-1.5 texte-libelle text-muted-foreground">
          <Info aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          {t('identite.autocompletion.horsReferentiel')}
        </p>
      ) : null}
    </div>
  );
}
