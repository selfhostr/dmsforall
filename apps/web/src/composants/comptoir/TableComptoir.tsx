import { ArrowUpDown } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';

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

  return (
    <Table densite={densite} className={className}>
      <TableHeader>
        <TableRow>
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
        ) : (
          lignes.map((ligne) => (
            <TableRow
              key={cleLigne(ligne)}
              role={onOuvrirLigne ? 'link' : undefined}
              aria-label={onOuvrirLigne ? libelleLigne?.(ligne) : undefined}
              tabIndex={onOuvrirLigne ? 0 : undefined}
              className={onOuvrirLigne ? 'cursor-pointer' : undefined}
              onClick={onOuvrirLigne ? () => gererClicLigne(ligne) : undefined}
              onKeyDown={
                onOuvrirLigne ? (evenement) => gererClavierLigne(evenement, ligne) : undefined
              }
            >
              {colonnes.map((colonne) => (
                <TableCell
                  key={colonne.id}
                  className={cn(classeAlignement(colonne.alignement), colonne.className)}
                  onClick={colonne.actions ? (evenement) => evenement.stopPropagation() : undefined}
                  onKeyDown={
                    colonne.actions ? (evenement) => evenement.stopPropagation() : undefined
                  }
                >
                  {colonne.rendu(ligne)}
                </TableCell>
              ))}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
