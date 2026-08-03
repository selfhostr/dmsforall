import {
  type HTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
  forwardRef,
} from 'react';

import { cn } from '@/lib/utils';

export type Densite = 'dense' | 'aeree' | 'tres-aeree';

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /** Contrat de densité — docs/design-etape-1-atelier.md §8.2. `dense` (bureau/comptoir) par
   *  défaut : les listes métier du comptoir (clients, véhicules) sont denses. */
  densite?: Densite;
}

// La classe `densite-*` pose les variables --densite-*/--texte-* (index.css) sur le wrapper ;
// TableRow/TableHead/TableCell les consomment sans jamais coder 40px/56px/72px en dur.
export const Table = forwardRef<HTMLTableElement, TableProps>(
  ({ className, densite = 'dense', ...props }, ref) => (
    <div className={cn('densite-' + densite, 'relative w-full overflow-auto')}>
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
