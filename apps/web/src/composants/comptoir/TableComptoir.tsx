import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowUpDown } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';

import type { SensTri } from '@dfa/shared';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  type Densite,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

import { useModeCarteComptoir } from './useModeCarteComptoir';

/** Au-delà de ce nombre de lignes, `TableComptoir` bascule en rendu virtualisé (issue #92 —
 *  fiche d'OR figée 1-2s avec 200 lignes / ~5700 nœuds DOM). En-deçà, comportement 100%
 *  identique à avant (mêmes nœuds, mêmes tests) : la quasi-totalité des écrans du comptoir
 *  paginent déjà côté API et ne franchissent jamais ce seuil — voir docs/design-comptoir.md
 *  et le rapport de mesure de l'issue #92 pour le choix de la valeur (repère guideline
 *  interne : listes de plus de 50 éléments). */
const SEUIL_VIRTUALISATION = 60;

/** Survol généreux : garde des lignes montées de part et d'autre de la fenêtre visible pour que
 *  Ctrl+F et la tabulation clavier restent utilisables sur un voisinage raisonnable de la
 *  position de scroll — limite connue de toute table virtualisée (voir commentaire sur
 *  `estVirtualise` plus bas) : recherche/tabulation restent fiables PRÈS du scroll courant, pas
 *  sur l'intégralité des lignes hors-écran. */
const SURVOL_VIRTUALISATION = 12;

/** Estimation initiale de hauteur de ligne par densité (`--densite-hauteur-ligne`, index.css) —
 *  seulement un point de départ pour le premier rendu : `useVirtualizer` mesure ensuite la
 *  hauteur RÉELLE de chaque ligne (contenu multi-lignes : désignation + icônes, montants
 *  empilés TTC/HT/calcul) via `measureElement`. */
const HAUTEUR_ESTIMEE_PAR_DENSITE: Record<Densite, number> = {
  dense: 40,
  aeree: 56,
  'tres-aeree': 72,
};

/** Même rôle que `HAUTEUR_ESTIMEE_PAR_DENSITE`, pour le repli en cartes (`useModeCarteComptoir`)
 *  sous le palier `md` (767px) : une carte empile au moins un titre + une grille de deux colonnes
 *  de valeurs, donc nettement plus haute qu'une ligne de table — simple point de départ,
 *  `measureElement` corrige à la hauteur réelle dès le premier rendu mesuré. */
const HAUTEUR_ESTIMEE_CARTE_PAR_DENSITE: Record<Densite, number> = {
  dense: 96,
  aeree: 120,
  'tres-aeree': 144,
};

/** Importance d'une colonne pour le repli en cartes — voir `ColonneComptoir.importance`. */
export type ImportanceColonneComptoir = 'principale' | 'secondaire' | 'discrete';

/** Une colonne de `TableComptoir`. `libelle` et le contenu de `rendu` sont fournis par
 *  l'écran appelant — déjà traduits (namespace du domaine, ex. `clients:liste.colonnes.*`) :
 *  ce composant ne porte aucun texte métier en dur. */
export interface ColonneComptoir<T> {
  readonly id: string;
  readonly libelle: ReactNode;
  /** Colonne triable : rend l'en-tête cliquable et pose `aria-sort`. Ignoré si `onTrier`
   *  n'est pas fourni au tableau. */
  readonly triable?: boolean;
  readonly alignement?: 'gauche' | 'droite';
  /** Colonne d'actions (menu, boutons) : le clic à l'intérieur n'active jamais la navigation
   *  de la ligne — voir `arreterPropagation` sur la cellule. */
  readonly actions?: boolean;
  readonly className?: string;
  readonly rendu: (ligne: T) => ReactNode;
  /** Priorité de la colonne en mode carte (repli sous 767px, `useModeCarteComptoir`) :
   *  `principale` compose l'en-tête de la carte (ce qui identifie la ligne et/ou décide de
   *  l'action — un écran peut en marquer plusieurs, ex. le titre ET le statut/prix),
   *  `secondaire` (DÉFAUT) rejoint la grille de valeurs du corps de carte, `discrete` est
   *  reléguée en pied de carte, en plus petit. Sans déclaration sur AUCUNE colonne (cas des dix
   *  écrans existants), la PREMIÈRE colonne de contenu (hors colonne `actions`) devient
   *  `principale` par défaut — un titre de carte raisonnable sans rien redéclarer. */
  readonly importance?: ImportanceColonneComptoir;
}

export interface EtatTriComptoir {
  readonly colonneId: string;
  readonly sens: SensTri;
}

export interface ProprietesTableComptoir<T> {
  readonly colonnes: ReadonlyArray<ColonneComptoir<T>>;
  readonly lignes: readonly T[];
  readonly cleLigne: (ligne: T) => string;
  readonly densite?: Densite;
  /** Tri courant, `null` si aucun. Piloté par l'appelant (paramètre `tri` de l'API). */
  readonly tri?: EtatTriComptoir | null;
  readonly onTrier?: (colonneId: string) => void;
  /** Navigation au clic/`Entrée` sur la ligne. Omis => lignes non cliquables (table de
   *  résumé, pas de fiche à ouvrir). */
  readonly onOuvrirLigne?: (ligne: T) => void;
  /** Nom accessible de la ligne quand `onOuvrirLigne` est fourni — posé en `aria-label` sur la
   *  carte (`role="link"`, repli mobile) et sur le `<button>` de la colonne identifiante (rendu
   *  table, 767px et au-delà, voir JSDoc du composant). Sans lui : la carte annonce « lien » sans
   *  dire lequel, le bouton de table retombe sur le texte visible de la colonne (moins précis mais
   *  jamais muet) — À FOURNIR dès que `onOuvrirLigne` l'est (déjà traduit par l'appelant, ex.
   *  `t('commun:actions.ouvrirElement', { nom: ligne.numero })`). */
  readonly libelleLigne?: (ligne: T) => string;
  /** `true` pendant le chargement initial : rend des lignes squelette au lieu du corps. */
  readonly enChargement?: boolean;
  readonly lignesSquelette?: number;
  /** Rendu explicite quand `lignes` est vide et `enChargement` est `false` — jamais un
   *  `<TableBody>` vide sans état (voir docs/design-comptoir.md §4). Composer
   *  `EtatVideRecherche`/`EtatVidePremierUsage` (motifs) ici. */
  readonly contenuVide?: ReactNode;
  readonly className?: string;
}

function classeAlignement(alignement: 'gauche' | 'droite' | undefined): string | undefined {
  return alignement === 'droite' ? 'text-right' : undefined;
}

function importanceEffective<T>(
  colonne: ColonneComptoir<T>,
  indexParmiContenu: number,
): ImportanceColonneComptoir {
  if (colonne.importance) return colonne.importance;
  return indexParmiContenu === 0 ? 'principale' : 'secondaire';
}

/**
 * Table dense du comptoir : en-têtes triables (`aria-sort`), lignes cliquables navigables au
 * clavier, colonne d'actions qui n'active pas la navigation. Densité `dense` par défaut
 * (contexte bureau/comptoir — docs/design-comptoir.md §1 et §4).
 *
 * LIGNE CLIQUABLE, RENDU TABLE (767px et au-delà) — PAS de `role` réassigné sur le `<tr>` : poser
 * `role="link"`/`role="button"` sur un `<tr>` REMPLACE son rôle implicite `row` (un `role` ne
 * s'ajoute jamais, il écrase), ce qui rend la table entière imparcourable en navigation par
 * tableau au lecteur d'écran (measuré par le harnais e2e — `getByRole('table').getByRole('row')`
 * ne trouvait plus que l'en-tête sur une table de 5 lignes, WCAG 1.3.1 ; `axe-core` ne détecte PAS
 * ce défaut). À la place : la ligne garde son rôle `row` natif et un `onClick` qui couvre le clic
 * souris n'importe où sur la ligne (`proprietesLigneTable`) ; la cellule de la première colonne de
 * contenu (hors colonne `actions` — celle que le mode carte désigne déjà `principale` par défaut,
 * voir `importanceEffective`) porte un vrai `<button>` autour de son contenu, qui capte le clavier
 * (Entrée/Espace natifs, pas de `onKeyDown` à réimplémenter) et le lecteur d'écran (annoncé comme
 * un bouton nommé, jamais un `<tr>` muet avec juste un `tabIndex`). `libelleLigne` porte ce nom
 * (`aria-label` du bouton) — à fournir par tout appelant qui passe `onOuvrirLigne`, sinon le
 * bouton retombe sur le texte visible de la colonne comme nom accessible.
 *
 * RENDU CARTE (repli sous 767px, `rendreCarte` plus bas) — `role="link"` sur la carte (`<div>`)
 * reste le bon patron : un `<div>` n'a pas de rôle implicite à écraser, donc rien à perdre ici
 * (`proprietesCarteCliquable`).
 *
 * REPLI EN CARTES (sous 767px, `useModeCarteComptoir`) — une table à plusieurs colonnes déborde
 * et se fait défiler au doigt sur téléphone (pire défaut mobile mesuré de l'appli, huit colonnes
 * sur la liste des véhicules en stock notamment). Sous ce palier, le rendu change ENTIÈREMENT de
 * structure (liste de cartes, pas une table maquillée en CSS) : la sémantique change réellement
 * (table -> liste), donc les rôles ARIA changent aussi plutôt que de garder `role="table"` sur du
 * contenu qui n'en est plus une. Piloté par LA MÊME définition de colonnes que la table (aucun
 * écran n'a besoin d'ajouter quoi que ce soit) : `colonne.importance` choisit la mise en avant,
 * `colonne.triable`/`onTrier` alimentent une rangée de puces de tri (équivalent tactile des
 * en-têtes cliquables, qui disparaissent avec les en-têtes), `colonne.actions` reste la zone
 * d'actions qui n'active pas la navigation de la carte. La virtualisation (au-delà de
 * `SEUIL_VIRTUALISATION`) s'applique aux DEUX rendus, avec une estimation de hauteur propre à
 * chacun (`HAUTEUR_ESTIMEE_PAR_DENSITE` / `HAUTEUR_ESTIMEE_CARTE_PAR_DENSITE`).
 */
export function TableComptoir<T>({
  colonnes,
  lignes,
  cleLigne,
  densite = 'dense',
  tri = null,
  onTrier,
  onOuvrirLigne,
  libelleLigne,
  enChargement = false,
  lignesSquelette = 5,
  contenuVide,
  className,
}: ProprietesTableComptoir<T>) {
  const { t } = useTranslation('commun');
  const enModeCarte = useModeCarteComptoir();

  const gererClicLigne = (ligne: T) => {
    onOuvrirLigne?.(ligne);
  };

  // Seul le mode carte (`rendreCarte`, `<div role="link">`) s'appuie encore sur ce clavier
  // manuel : en rendu table, le `<button>` natif de `rendreCellules` gère Entrée/Espace tout
  // seul, rien à réimplémenter (voir JSDoc du composant).
  const gererClavierLigne = (evenement: KeyboardEvent<HTMLDivElement>, ligne: T) => {
    if (!onOuvrirLigne) return;
    if (evenement.key === 'Enter' || evenement.key === ' ') {
      evenement.preventDefault();
      onOuvrirLigne(ligne);
    }
  };

  // Impression : une table virtualisée ne doit JAMAIS imprimer une feuille d'atelier tronquée
  // aux seules lignes montées à l'écran (issue #92 — ce produit sert à imprimer des feuilles
  // d'atelier). `beforeprint`/`afterprint` couvrent Chrome/Firefox/Safari ; `matchMedia('print')`
  // en repli pour le cas où l'impression est déclenchée sans ces deux événements. Pendant
  // l'impression, `estVirtualise` repasse à `false` plus bas : le rendu retombe intégralement
  // sur le chemin non virtualisé (toutes les lignes, sans conteneur de défilement borné).
  //
  // `flushSync` plutôt qu'un `setState` batché ordinaire : MESURÉ (Chromium headless) que
  // `beforeprint`/`afterprint` peuvent se déclencher de façon SYNCHRONE, l'un juste après l'autre,
  // dans le même tour de pile — sans lui, les deux `setState` (true puis false) se neutralisent
  // avant que React n'ait la moindre occasion de committer le rendu complet, et l'impression
  // capture silencieusement la table encore tronquée à la fenêtre virtualisée. Dans un navigateur
  // réel avec une vraie boîte de dialogue d'impression, l'écart est de plusieurs secondes (pas de
  // risque) — mais rien ne garantit cet écart pour une impression déclenchée par script (test,
  // automatisation), d'où cette précaution même si le cas interactif normal s'en passerait.
  const [enImpression, setEnImpression] = useState(false);
  useEffect(() => {
    const gererAvantImpression = () => flushSync(() => setEnImpression(true));
    const gererApresImpression = () => flushSync(() => setEnImpression(false));
    window.addEventListener('beforeprint', gererAvantImpression);
    window.addEventListener('afterprint', gererApresImpression);

    // `window.matchMedia` : absent de jsdom (environnement de test, jamais d'un vrai navigateur)
    // — protégé pour ne pas faire planter tout écran qui monte une table sous vitest. En repli,
    // seuls `beforeprint`/`afterprint` (déjà posés ci-dessus) pilotent `enImpression`.
    const mediaImpression =
      typeof window.matchMedia === 'function' ? window.matchMedia('print') : null;
    const gererChangementMedia = (evenement: MediaQueryListEvent) =>
      flushSync(() => setEnImpression(evenement.matches));
    mediaImpression?.addEventListener('change', gererChangementMedia);

    return () => {
      window.removeEventListener('beforeprint', gererAvantImpression);
      window.removeEventListener('afterprint', gererApresImpression);
      mediaImpression?.removeEventListener('change', gererChangementMedia);
    };
  }, []);

  // En-deçà du seuil (l'immense majorité des écrans, qui paginent déjà côté API) : `estVirtualise`
  // reste `false` en permanence, `virtualiseur` tourne à vide (count 0) et le rendu emprunte
  // EXACTEMENT le même chemin qu'avant ce correctif — aucun nœud ni comportement supplémentaire.
  const estVirtualisable = !enChargement && lignes.length > SEUIL_VIRTUALISATION;
  const estVirtualise = estVirtualisable && !enImpression;

  const conteneurDefilementRef = useRef<HTMLDivElement>(null);
  const virtualiseur = useVirtualizer({
    count: estVirtualise ? lignes.length : 0,
    getScrollElement: () => conteneurDefilementRef.current,
    estimateSize: () =>
      (enModeCarte ? HAUTEUR_ESTIMEE_CARTE_PAR_DENSITE : HAUTEUR_ESTIMEE_PAR_DENSITE)[densite],
    overscan: SURVOL_VIRTUALISATION,
  });

  // Colonne « identifiante » de la ligne en rendu table : même choix par défaut que le mode carte
  // (`importanceEffective` — première colonne de contenu, hors `actions`), réutilisé ici comme
  // ancrage du vrai `<button>` clavier/lecteur d'écran de la ligne (voir JSDoc du composant).
  const colonneIdentifianteLigne = colonnes.find((colonne) => !colonne.actions);

  function rendreCellules(ligne: T) {
    return colonnes.map((colonne) => {
      const estColonneIdentifiante =
        Boolean(onOuvrirLigne) && colonneIdentifianteLigne?.id === colonne.id;
      return (
        <TableCell
          key={colonne.id}
          className={cn(classeAlignement(colonne.alignement), colonne.className)}
          onClick={colonne.actions ? (evenement) => evenement.stopPropagation() : undefined}
          onKeyDown={colonne.actions ? (evenement) => evenement.stopPropagation() : undefined}
        >
          {estColonneIdentifiante ? (
            // `stopPropagation` : sans lui, le clic bulle jusqu'au `onClick` du `<tr>`
            // (`proprietesLigneTable`) et `onOuvrirLigne` serait appelé deux fois pour un seul
            // clic sur ce bouton — même garde que la colonne `actions` juste au-dessus.
            <button
              type="button"
              className="anneau-focus-interne block w-full rounded-sm"
              onClick={(evenement) => {
                evenement.stopPropagation();
                gererClicLigne(ligne);
              }}
              aria-label={libelleLigne?.(ligne)}
            >
              {colonne.rendu(ligne)}
            </button>
          ) : (
            colonne.rendu(ligne)
          )}
        </TableCell>
      );
    });
  }

  /** Rendu carte (repli mobile, `<div>`) : `role="link"` valide ici, rien à écraser. */
  function proprietesCarteCliquable(ligne: T) {
    return {
      role: onOuvrirLigne ? ('link' as const) : undefined,
      'aria-label': onOuvrirLigne ? libelleLigne?.(ligne) : undefined,
      tabIndex: onOuvrirLigne ? 0 : undefined,
      className: onOuvrirLigne ? 'cursor-pointer' : undefined,
      onClick: onOuvrirLigne ? () => gererClicLigne(ligne) : undefined,
      onKeyDown: onOuvrirLigne
        ? (evenement: KeyboardEvent<HTMLDivElement>) => gererClavierLigne(evenement, ligne)
        : undefined,
    };
  }

  /** Rendu table (`<tr>`) : clic souris n'importe où sur la ligne, SANS `role`/`tabIndex` — le
   *  rôle `row` natif reste intact, le clavier/lecteur d'écran passent par le `<button>` de
   *  `rendreCellules` (colonne identifiante). */
  function proprietesLigneTable(ligne: T) {
    return {
      className: onOuvrirLigne ? 'cursor-pointer' : undefined,
      onClick: onOuvrirLigne ? () => gererClicLigne(ligne) : undefined,
    };
  }

  const elementsVirtuels = estVirtualise ? virtualiseur.getVirtualItems() : [];
  const paddingHaut = elementsVirtuels.length > 0 ? (elementsVirtuels[0]?.start ?? 0) : 0;
  const paddingBas =
    elementsVirtuels.length > 0
      ? virtualiseur.getTotalSize() - (elementsVirtuels[elementsVirtuels.length - 1]?.end ?? 0)
      : 0;

  // ── Mode carte (repli sous 767px) ────────────────────────────────────────────────────────
  const colonnesActions = colonnes.filter((colonne) => colonne.actions);
  const colonnesContenu = colonnes.filter((colonne) => !colonne.actions);
  const colonnesPrincipales = colonnesContenu.filter(
    (colonne, index) => importanceEffective(colonne, index) === 'principale',
  );
  const colonnesSecondaires = colonnesContenu.filter(
    (colonne, index) => importanceEffective(colonne, index) === 'secondaire',
  );
  const colonnesDiscretes = colonnesContenu.filter(
    (colonne, index) => importanceEffective(colonne, index) === 'discrete',
  );
  const colonnesTriables = colonnes.filter((colonne) => colonne.triable);

  function rendreCarte(ligne: T) {
    const proprietesClic = proprietesCarteCliquable(ligne);
    return (
      // BORDURE CONSERVÉE (DESIGN.md « Bordure structurelle uniquement », exception explicite :
      // « carte cliquable d'un repli mobile de tableau ») — ce `<div>` EST la ligne de table une
      // fois repliée sous 767px, pas un simple groupe de contenu.
      <div
        {...proprietesClic}
        className={cn(
          'anneau-focus flex min-h-11 flex-col gap-2 rounded-lg border bg-card p-3 texte-corps transition-colors',
          proprietesClic.className,
          onOuvrirLigne ? 'hover:bg-muted/50' : undefined,
        )}
      >
        {colonnesPrincipales.length > 0 ? (
          <div className="flex flex-col gap-0.5">
            {colonnesPrincipales.map((colonne) => (
              <div
                key={colonne.id}
                className={cn('font-medium', classeAlignement(colonne.alignement))}
              >
                {colonne.rendu(ligne)}
              </div>
            ))}
          </div>
        ) : null}

        {colonnesSecondaires.length > 0 ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {colonnesSecondaires.map((colonne) => (
              <div key={colonne.id} className="flex min-w-0 flex-col">
                <dt className="texte-petit truncate text-muted-foreground">{colonne.libelle}</dt>
                <dd className={cn('truncate', classeAlignement(colonne.alignement))}>
                  {colonne.rendu(ligne)}
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {colonnesDiscretes.length > 0 ? (
          <div className="texte-petit flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
            {colonnesDiscretes.map((colonne) => (
              // Séparateur TEXTUEL (` : `), pas un `gap` flex entre deux `<span>` : vérifié au
              // rendu réel (390px) — le `gap` entre deux éléments flex ne garantit pas un espace
              // visuellement net une fois le texte compressé, alors qu'un espace dans le flux de
              // texte, si.
              <span key={colonne.id}>
                {colonne.libelle} : {colonne.rendu(ligne)}
              </span>
            ))}
          </div>
        ) : null}

        {colonnesActions.length > 0 ? (
          // Même garde que `rendreCellules` (table) : le clic/`Entrée` dans la zone d'actions
          // n'active jamais l'ouverture de la carte. `[&_button]:min-h-11` : plancher de cible
          // tactile 44px NON garanti par `Button size="sm"` (primitive hors périmètre de ce
          // composant) — posé ici en ceinture de sécurité pour toute action rendue en carte.
          <div
            className="flex flex-wrap items-center gap-2 [&_button]:min-h-11"
            onClick={(evenement) => evenement.stopPropagation()}
            onKeyDown={(evenement) => evenement.stopPropagation()}
          >
            {colonnesActions.map((colonne) => (
              <span key={colonne.id}>{colonne.rendu(ligne)}</span>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (enModeCarte) {
    // Équivalent tactile des en-têtes triables : disparus avec les en-têtes de table, remplacés
    // par une rangée de puces (mêmes `colonne.id`/`onTrier` que le clic sur un en-tête — un
    // écran qui trie déjà via `TableComptoir` n'a rien à ajouter).
    const controleTri =
      onTrier && colonnesTriables.length > 0 ? (
        <div
          role="group"
          aria-label={t('commun:tableComptoir.trierPar')}
          className="flex flex-wrap gap-2"
        >
          {colonnesTriables.map((colonne) => {
            const estTriee = tri?.colonneId === colonne.id;
            return (
              <button
                key={colonne.id}
                type="button"
                aria-pressed={estTriee}
                onClick={() => onTrier(colonne.id)}
                className={cn(
                  'anneau-focus texte-corps inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 transition-colors',
                  estTriee
                    ? 'border-primary bg-primary/10 font-medium text-primary'
                    : 'border-input text-muted-foreground hover:text-foreground',
                )}
              >
                {colonne.libelle}
                <ArrowUpDown aria-hidden className="h-3.5 w-3.5" />
              </button>
            );
          })}
        </div>
      ) : null;

    let corps: ReactNode;
    if (enChargement) {
      corps = (
        <ul role="list" className="flex flex-col gap-2">
          {Array.from({ length: lignesSquelette }, (_, index) => (
            // Même bordure que `rendreCarte` ci-dessus (repli mobile) : le squelette de
            // chargement doit occuper exactement la silhouette de la carte qu'il précède.
            <li key={`squelette-carte-${index}`} className="rounded-lg border bg-card p-3">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-2/3" aria-hidden="true" />
                <Skeleton className="h-3 w-1/2" aria-hidden="true" />
                <Skeleton className="h-3 w-1/3" aria-hidden="true" />
              </div>
            </li>
          ))}
        </ul>
      );
    } else if (lignes.length === 0) {
      corps = contenuVide;
    } else if (estVirtualise) {
      corps = (
        <div ref={conteneurDefilementRef} className="max-h-[70dvh] overflow-auto">
          <ul role="list">
            {paddingHaut > 0 ? <li aria-hidden="true" style={{ height: paddingHaut }} /> : null}
            {elementsVirtuels.map((elementVirtuel) => {
              const ligne = lignes[elementVirtuel.index];
              if (!ligne) return null;
              return (
                <li
                  key={cleLigne(ligne)}
                  data-index={elementVirtuel.index}
                  ref={virtualiseur.measureElement}
                  aria-setsize={lignes.length}
                  aria-posinset={elementVirtuel.index + 1}
                  className="pb-2"
                >
                  {rendreCarte(ligne)}
                </li>
              );
            })}
            {paddingBas > 0 ? <li aria-hidden="true" style={{ height: paddingBas }} /> : null}
          </ul>
        </div>
      );
    } else {
      corps = (
        <ul role="list">
          {lignes.map((ligne) => (
            <li key={cleLigne(ligne)} className="pb-2">
              {rendreCarte(ligne)}
            </li>
          ))}
        </ul>
      );
    }

    return (
      <div className={cn('flex flex-col gap-2', className)}>
        {controleTri}
        {corps}
      </div>
    );
  }

  // ── Table (767px et au-delà) ─────────────────────────────────────────────────────────────
  const table = (
    <Table
      densite={densite}
      className={className}
      aria-rowcount={estVirtualise ? lignes.length + 1 : undefined}
    >
      <TableHeader>
        <TableRow aria-rowindex={estVirtualise ? 1 : undefined}>
          {colonnes.map((colonne) => {
            const estTriee = tri?.colonneId === colonne.id;
            const ariaSort =
              !colonne.triable || !onTrier
                ? undefined
                : estTriee
                  ? tri.sens === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none';
            return (
              <TableHead
                key={colonne.id}
                className={cn(classeAlignement(colonne.alignement), colonne.className)}
                aria-sort={ariaSort}
              >
                {colonne.triable && onTrier ? (
                  <button
                    type="button"
                    className={cn(
                      'inline-flex items-center gap-1 hover:text-foreground',
                      colonne.alignement === 'droite' && 'flex-row-reverse',
                    )}
                    onClick={() => onTrier(colonne.id)}
                  >
                    {colonne.libelle}
                    <ArrowUpDown aria-hidden className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  colonne.libelle
                )}
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {enChargement ? (
          Array.from({ length: lignesSquelette }, (_, index) => (
            <TableRow key={`squelette-${index}`}>
              {colonnes.map((colonne) => (
                <TableCell key={colonne.id} className={classeAlignement(colonne.alignement)}>
                  <Skeleton className="h-4 w-full" aria-hidden="true" />
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : lignes.length === 0 ? (
          <TableRow>
            <TableCell colSpan={colonnes.length} className="p-0">
              {contenuVide}
            </TableCell>
          </TableRow>
        ) : estVirtualise ? (
          <>
            {paddingHaut > 0 ? (
              <tr aria-hidden="true">
                <td
                  colSpan={colonnes.length}
                  style={{ height: paddingHaut, padding: 0, border: 0 }}
                />
              </tr>
            ) : null}
            {elementsVirtuels.map((elementVirtuel) => {
              const ligne = lignes[elementVirtuel.index];
              if (!ligne) return null;
              return (
                <TableRow
                  key={cleLigne(ligne)}
                  data-index={elementVirtuel.index}
                  ref={virtualiseur.measureElement}
                  aria-rowindex={elementVirtuel.index + 2}
                  {...proprietesLigneTable(ligne)}
                >
                  {rendreCellules(ligne)}
                </TableRow>
              );
            })}
            {paddingBas > 0 ? (
              <tr aria-hidden="true">
                <td
                  colSpan={colonnes.length}
                  style={{ height: paddingBas, padding: 0, border: 0 }}
                />
              </tr>
            ) : null}
          </>
        ) : (
          lignes.map((ligne) => (
            <TableRow key={cleLigne(ligne)} {...proprietesLigneTable(ligne)}>
              {rendreCellules(ligne)}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );

  // Conteneur de défilement borné : SEULEMENT pendant la virtualisation réelle. Table courte ou
  // impression => pas de `<div>` supplémentaire, DOM strictement identique à avant ce correctif.
  if (!estVirtualise) return table;
  return (
    <div ref={conteneurDefilementRef} className="max-h-[70dvh] overflow-auto">
      {table}
    </div>
  );
}
