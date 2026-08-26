import { createContext, type HTMLAttributes, forwardRef, useContext } from 'react';

import { cn } from '@/lib/utils';

/**
 * SURFACE SEULE, PAS DE CONTOUR NI D'OMBRE — refonte visuelle, voir DESIGN.md « Bordure
 * structurelle uniquement ». `card.tsx` cumulait jusqu'ici `border` ET `shadow-sm` sur les mêmes
 * 85 usages du produit : M3 traite l'outline (« card outlined », niveau 0) et l'elevation
 * (« card elevated », niveau 1) comme deux façons ALTERNATIVES de séparer une carte du fond, jamais
 * cumulées — les cumuler dessinait deux fois la même frontière. Ici : `bg-card` + le delta de
 * surface avec `--background` (mécanisme d'elevation par contraste, pas de bordure ni d'ombre) —
 * `shadow-sm` reste réservé à ce qui flotte vraiment (menu, popover, dialogue — familles Radix,
 * jamais touchées par ce lot).
 *
 * RÉSERVE HONNÊTE, PAS IGNORÉE : en sombre, ce delta de surface seul (`--card` sur `--background`)
 * ne vaut que ~1.07:1 — quasi imperceptible pris isolément (1.14:1 en clair, à peine plus net). Ce
 * n'est délibérément PAS le mécanisme de séparation principal : ce qui sépare réellement deux
 * cartes voisines, c'est l'espacement entre elles (`gap-section`, posé par
 * `composants/motifs/GabaritEcran.tsx`, hors périmètre de ce fichier) et le poids visuel de
 * `CardTitle` (16px/600 contre 14px/400 pour le corps, ci-dessous). Un futur écran qui poserait des
 * cartes SANS cet espacement autour (grille serrée, cartes collées) perdrait toute séparation
 * visible : à vérifier au cas par cas, pas un défaut de ce composant.
 */
const ContexteDensiteCarte = createContext(false);

function useDensiteCompacteCarte(): boolean {
  return useContext(ContexteDensiteCarte);
}

interface PropsCard extends HTMLAttributes<HTMLDivElement> {
  /**
   * NOUVEAU (refonte visuelle) — bascule `--espace-carte` (défaut) vers `--espace-carte-compacte`
   * dans `CardHeader`/`CardContent`/`CardFooter`, sans que ces trois composants n'aient chacun leur
   * propre prop à répéter : `Card` porte la décision une fois, `CardHeader`/`CardContent`/
   * `CardFooter` la lisent par contexte. Réservé aux cartes à contenu minimal (un chiffre, un
   * titre, un libellé) qui payaient jusqu'ici le même rembourrage qu'une fiche à quinze champs —
   * voir le commentaire de `--espace-carte-compacte` dans `index.css`. AUCUN écran de ce dépôt ne
   * pose encore cette prop : ce lot livre le levier, pas son application (hors périmètre :
   * `apps/web/src/ecrans/`).
   */
  readonly compact?: boolean;
}

export const Card = forwardRef<HTMLDivElement, PropsCard>(
  ({ className, compact = false, ...props }, ref) => (
    <ContexteDensiteCarte.Provider value={compact}>
      <div
        ref={ref}
        className={cn('rounded-lg bg-card text-card-foreground', className)}
        {...props}
      />
    </ContexteDensiteCarte.Provider>
  ),
);
Card.displayName = 'Card';

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const compact = useDensiteCompacteCarte();
    return (
      <div
        ref={ref}
        className={cn(
          'flex flex-col gap-champ',
          compact ? 'p-carte-compacte' : 'p-carte',
          className,
        )}
        {...props}
      />
    );
  },
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h2 ref={ref} className={cn('texte-titre-section leading-none', className)} {...props} />
  ),
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('texte-corps text-muted-foreground', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

export const CardContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const compact = useDensiteCompacteCarte();
    return (
      <div
        ref={ref}
        className={cn(compact ? 'p-carte-compacte' : 'p-carte', 'pt-0', className)}
        {...props}
      />
    );
  },
);
CardContent.displayName = 'CardContent';

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const compact = useDensiteCompacteCarte();
    return (
      <div
        ref={ref}
        className={cn(
          'flex items-center gap-controles',
          compact ? 'p-carte-compacte' : 'p-carte',
          'pt-0',
          className,
        )}
        {...props}
      />
    );
  },
);
CardFooter.displayName = 'CardFooter';
