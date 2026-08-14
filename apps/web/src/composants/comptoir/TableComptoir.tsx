import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowUpDown } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';

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
  /** Nom accessible de la ligne quand `onOuvrirLigne` est fourni — posé en `aria-label` sur le
   *  `role="link"` de la ligne. Sans lui, un lecteur d'écran annonce « lien » sans dire lequel :
   *  À FOURNIR dès que `onOuvrirLigne` l'est (déjà traduit par l'appelant, ex.
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

/**
 * Table dense du comptoir : en-têtes triables (`aria-sort`), lignes cliquables navigables au
 * clavier, colonne d'actions qui n'active pas la navigation. Densité `dense` par défaut
 * (contexte bureau/comptoir — docs/design-comptoir.md §1 et §4).
 *
 * Ligne cliquable = `role="link"` : sans nom accessible, un lecteur d'écran annonce « lien »
 * sans dire lequel. `libelleLigne` porte ce nom (`aria-label`) — à fournir par tout appelant qui
 * passe `onOuvrirLigne`.
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
  const gererClicLigne = (ligne: T) => {
    onOuvrirLigne?.(ligne);
  };

  const gererClavierLigne = (evenement: KeyboardEvent<HTMLTableRowElement>, ligne: T) => {
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
    estimateSize: () => HAUTEUR_ESTIMEE_PAR_DENSITE[densite],
    overscan: SURVOL_VIRTUALISATION,
  });

  function rendreCellules(ligne: T) {
    return colonnes.map((colonne) => (
      <TableCell
        key={colonne.id}
        className={cn(classeAlignement(colonne.alignement), colonne.className)}
        onClick={colonne.actions ? (evenement) => evenement.stopPropagation() : undefined}
        onKeyDown={colonne.actions ? (evenement) => evenement.stopPropagation() : undefined}
      >
        {colonne.rendu(ligne)}
      </TableCell>
    ));
  }

  function proprietesLigneCliquable(ligne: T) {
    return {
      role: onOuvrirLigne ? ('link' as const) : undefined,
      'aria-label': onOuvrirLigne ? libelleLigne?.(ligne) : undefined,
      tabIndex: onOuvrirLigne ? 0 : undefined,
      className: onOuvrirLigne ? 'cursor-pointer' : undefined,
      onClick: onOuvrirLigne ? () => gererClicLigne(ligne) : undefined,
      onKeyDown: onOuvrirLigne
        ? (evenement: KeyboardEvent<HTMLTableRowElement>) => gererClavierLigne(evenement, ligne)
        : undefined,
    };
  }

  const elementsVirtuels = estVirtualise ? virtualiseur.getVirtualItems() : [];
  const paddingHaut = elementsVirtuels.length > 0 ? (elementsVirtuels[0]?.start ?? 0) : 0;
  const paddingBas =
    elementsVirtuels.length > 0
      ? virtualiseur.getTotalSize() - (elementsVirtuels[elementsVirtuels.length - 1]?.end ?? 0)
      : 0;

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
                  {...proprietesLigneCliquable(ligne)}
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
            <TableRow key={cleLigne(ligne)} {...proprietesLigneCliquable(ligne)}>
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
