import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
} from 'react';

import { cn } from '@/lib/utils';

// Même exception i18n que dialog.tsx (voir son en-tête).
const LIBELLE_FERMER = 'Fermer';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;

export const SheetOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-50 bg-foreground/50 animation-voile', className)}
    {...props}
  />
));
SheetOverlay.displayName = 'SheetOverlay';

// Le glissement est porté par `.animation-panneau` (index.css) ; chaque côté ne fournit que
// son point de départ via `--panneau-depart`. Une seule paire d'images-clés pour les quatre
// directions, au lieu de huit classes du greffon `tailwindcss-animate` — qui n'est pas installé
// dans ce dépôt et dont aucune des classes n'était donc réellement générée (voir index.css).
//
// `flex flex-col overflow-hidden` : ce panneau (cadre) ne défile jamais lui-même — comme pour
// `dialog.tsx`, tout le défilement se passe dans le corps interne rendu par `SheetContent`
// ci-dessous, jamais ici, sinon le bouton de fermeture (positionné en absolu par rapport à ce
// cadre) défilerait hors champ avec le contenu (même défaut que l'issue #67 sur les dialogues).
// `left`/`right` sont déjà bornés par `h-full` (= hauteur de la fenêtre) ; `top`/`bottom` ne
// l'étaient par aucune borne avant ce correctif — un panneau haut/bas avec beaucoup de contenu
// pouvait donc déborder de la fenêtre sans le moindre défilement possible.
const variantesSheet = cva(
  'fixed z-50 flex flex-col overflow-hidden bg-background shadow-lg animation-panneau',
  {
    variants: {
      side: {
        left: 'inset-y-0 left-0 h-full border-r [--panneau-depart:translateX(-100%)]',
        right: 'inset-y-0 right-0 h-full border-l [--panneau-depart:translateX(100%)]',
        top: 'inset-x-0 top-0 max-h-[90vh] border-b [--panneau-depart:translateY(-100%)]',
        bottom: 'inset-x-0 bottom-0 max-h-[90vh] border-t [--panneau-depart:translateY(100%)]',
      },
    },
    defaultVariants: { side: 'right' },
  },
);

export interface SheetContentProps
  extends
    ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof variantesSheet> {}

export const SheetContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  SheetContentProps
>(({ side = 'right', className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(variantesSheet({ side }), className)}
      {...props}
    >
      <div
        className={cn(
          // Le corps : seul élément qui défile (voir le commentaire sur `variantesSheet`
          // ci-dessus). `min-h-0` est indispensable pour qu'un enfant flex accepte de rétrécir
          // sous la taille de son contenu — sans lui le défilement ne se déclenche jamais.
          // Même `className` que le cadre ci-dessus réappliquée à dessein : un écran qui passe
          // déjà `p-0` (ex. le tiroir de navigation, qui gère sa propre mise en page) doit
          // continuer à annuler le remplissage par défaut de cette zone, pas seulement celui
          // du cadre.
          // `content-start auto-rows-min` : sans eux, les lignes de la grille s'étirent pour remplir
          // la hauteur du panneau et décollent le contenu du titre (~250 px de vide). Un panneau
          // qui veut un pied collé en bas passe `grid-rows-[auto_1fr_auto]` (voir PanneauLateral).
          'grid min-h-0 flex-1 content-start auto-rows-min gap-groupe overflow-y-auto overscroll-contain p-carte',
          className,
        )}
      >
        {children}
      </div>
      <DialogPrimitive.Close
        className={cn(
          // 44x44 comme toute cible tactile du produit : l'icône seule mesurait 20 px, soit
          // moins de la moitié de la cible minimale — le bouton le plus utilisé d'une boîte de
          // dialogue sur tablette était le plus difficile à atteindre.
          // Reste un enfant direct du CADRE (pas du corps défilable) : c'est ce qui le maintient
          // toujours visible dans le coin, même quand le corps défile.
          // `z-20` : ce bouton et `SheetHeader`/`SheetFooter` (`z-10`, sticky) partagent la
          // même pile locale — celle du cadre, `position: fixed` + `z-50`, qui forme son propre
          // contexte d'empilement. Sans valeur explicite ici le bouton retombait à `z-index:
          // auto` et un en-tête `sticky` à `z-10` le recouvrait visuellement ET absorbait le
          // clic (survol/clic simulés retombent sur le premier élément peint au-dessus). `z-20`
          // le remet au-dessus des deux zones collées (`z-10`) sans jamais rivaliser avec les
          // popovers/menus/infobulles : ceux-ci sont portés par Radix vers `document.body`, donc
          // hors de ce contexte d'empilement local — aucun risque de passer devant eux.
          'absolute right-2 top-2 z-20 inline-flex h-11 w-11 items-center justify-center rounded-md',
          'text-muted-foreground transition-colors anneau-focus',
          'hover:bg-muted hover:text-foreground',
        )}
      >
        <X aria-hidden="true" className="h-5 w-5" />
        <span className="sr-only">{LIBELLE_FERMER}</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </SheetPortal>
));
SheetContent.displayName = 'SheetContent';

export function SheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      // `sticky top-0` : reste visible en haut du corps défilable pendant que le reste défile
      // dessous (même correctif que `DialogHeader`, voir `dialog.tsx`).
      // `pr-12` : réserve la largeur du bouton de fermeture (44 px + décalage `right-2`) pour
      // qu'un titre long ne passe jamais derrière lui, quel que soit le rembourrage `p-carte`
      // (16 px sur mobile/tablette, 24 px en desktop) déjà posé par le corps défilable parent.
      className={cn(
        'sticky top-0 z-10 flex flex-col gap-champ bg-background pr-12 text-left',
        className,
      )}
      {...props}
    />
  );
}

export function SheetFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      // Pas encore utilisé dans le produit (aucun panneau n'a de pied d'actions dédié
      // aujourd'hui), mais exporté par symétrie avec `DialogFooter` pour que le prochain panneau
      // qui a besoin d'actions toujours visibles n'ait pas à réinventer le collage en bas.
      className={cn(
        'sticky bottom-0 z-10 flex flex-col-reverse gap-controles bg-background sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}

export const SheetTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('texte-titre-section text-foreground', className)}
    {...props}
  />
));
SheetTitle.displayName = 'SheetTitle';

export const SheetDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('texte-corps text-muted-foreground', className)}
    {...props}
  />
));
SheetDescription.displayName = 'SheetDescription';
