import {
  type HTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
  forwardRef,
} from 'react';

import { cn } from '@/lib/utils';

export type Densite = 'dense' | 'aeree' | 'tres-aeree';

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /** Contrat de densité — docs/design-etape-1-atelier.md §8.2. ABSENT par défaut : le tableau
   *  HÉRITE de la densité de l'appareil posée sur `<html>` (`useDensite`, `SynchronisationDensite`)
   *  — 40 px en `compacte`, 48 px en `aeree`. Ne le forcer que pour un cas qui diffère
   *  réellement de l'appareil (borne de pointage : `tres-aeree`). */
  densite?: Densite;
}

// La classe `densite-*` pose les variables --densite-*/--texte-* (index.css) sur le wrapper ;
// TableRow/TableHead/TableCell les consomment sans jamais coder 40px/56px/72px en dur.
//
// `overflow-auto` reste volontaire ICI : une table HTML brute (colonnes fixes) reste le meilleur
// rendu tant qu'elle tient à l'écran, et un défilement horizontal est un repli correct pour un
// tableau ÉTROIT en contexte bureau/tablette qui déborde de peu. Le vrai défaut mobile (une table
// à 8 colonnes qui se fait défiler au doigt sur téléphone, mesuré sur la liste des véhicules en
// stock) est corrigé en amont, dans `TableComptoir` (composants/comptoir/) : sous 767px, ce
// composant partagé ne rend plus DU TOUT de `<Table>` — il bascule sur un repli en cartes piloté
// par la définition de colonnes, pour les dix écrans de liste qui passent par lui. Cette primitive
// reste volontairement une table HTML classique, sans logique responsive : les quelques écrans qui
// l'utilisent directement (hors `TableComptoir`) portent des tables de détail à peu de colonnes,
// hors périmètre de ce chantier.
export const Table = forwardRef<HTMLTableElement, TableProps>(
  ({ className, densite, ...props }, ref) => (
    <div className={cn(densite && 'densite-' + densite, 'relative w-full overflow-auto')}>
      <table ref={ref} className={cn('w-full caption-bottom texte-corps', className)} {...props} />
    </div>
  ),
);
Table.displayName = 'Table';

export const TableHeader = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('[&_tr]:border-b', className)} {...props} />
));
TableHeader.displayName = 'TableHeader';

export const TableBody = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
));
TableBody.displayName = 'TableBody';

export const TableFooter = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot ref={ref} className={cn('border-t bg-muted/50 font-medium', className)} {...props} />
));
TableFooter.displayName = 'TableFooter';

/** Ligne cliquable : ajouter `role="button" tabIndex={0} onKeyDown={...}` côté appelant pour
 *  activer au clavier (patron détaillé dans docs/design-comptoir.md « Table dense »). */
export const TableRow = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'h-[var(--densite-hauteur-ligne,40px)] border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
        // Sans effet tant que la ligne n'est pas focusable ; l'anneau apparaît de lui-même dès
        // que l'appelant applique le patron `role="button" tabIndex={0}` documenté ci-dessus,
        // pour qu'une liste cliquable ne puisse pas naître sans indicateur de focus.
        'anneau-focus',
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = 'TableRow';

export const TableHead = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        'px-[var(--densite-padding-x,0.75rem)] py-[var(--densite-padding-y,0.5rem)] text-left align-middle texte-libelle font-medium [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  ),
);
TableHead.displayName = 'TableHead';

export const TableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn(
        'px-[var(--densite-padding-x,0.75rem)] py-[var(--densite-padding-y,0.5rem)] align-middle [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  ),
);
TableCell.displayName = 'TableCell';

export const TableCaption = forwardRef<
  HTMLTableCaptionElement,
  HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('mt-4 texte-libelle', className)} {...props} />
));
TableCaption.displayName = 'TableCaption';
