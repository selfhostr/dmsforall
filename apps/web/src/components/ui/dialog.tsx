import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
} from 'react';

import { cn } from '@/lib/utils';

// Ce composant vit dans `components/ui/` (primitives génériques) mais rend un mot lu par les
// lecteurs d'écran. Même exception que `date-input.tsx` : la règle « aucune chaîne en dur » de
// CONTRIBUTING.md prime sur la convention « générique/anglais » de ce dossier. Le libellé reste ici
// en français figé faute de contexte i18n dans une primitive ; à brancher sur une clé
// `commun:fermer` dès que ce dossier accepte un hook de traduction.
const LIBELLE_FERMER = 'Fermer';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export const DialogOverlay = forwardRef<
  ElementRef<typeof DialogPrimitive.Overlay>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-50 bg-foreground/50 animation-voile', className)}
    {...props}
  />
));
DialogOverlay.displayName = 'DialogOverlay';

export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        // Le panneau (cadre) : jamais plus haut que la fenêtre, et ne défile jamais lui-même —
        // sinon le bouton de fermeture ci-dessous, positionné en absolu par rapport à CE cadre,
        // défilerait hors champ avec le contenu. Tout le défilement se passe dans le corps
        // ci-dessous (voir issue #67 : sur un formulaire long, le bouton « Confirmer » sortait
        // du viewport sans qu'aucun défilement ne soit possible pour l'atteindre).
        'fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border bg-background shadow-lg',
        'animation-dialogue',
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          // Le corps : seul élément qui défile. `min-h-0` est indispensable — sans lui un enfant
          // flex refuse de rétrécir sous la taille de son contenu et le défilement ne se
          // déclenche jamais, quelle que soit la hauteur imposée au parent. `overscroll-contain`
          // empêche le défilement de « fuiter » vers la page derrière le dialogue.
          // La même `className` que le cadre ci-dessus est réappliquée ici à dessein : les
          // écrans qui passaient déjà `p-0`/`gap-0`/`overflow-hidden` (ex. la palette de
          // commandes) gèrent leur propre mise en page interne et doivent continuer à annuler
          // le remplissage/le défilement par défaut de cette zone, pas seulement ceux du cadre.
          'grid min-h-0 flex-1 gap-groupe overflow-y-auto overscroll-contain p-carte',
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
          'absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-md',
          'text-muted-foreground transition-colors anneau-focus',
          'hover:bg-muted hover:text-foreground',
        )}
      >
        <X aria-hidden="true" className="h-5 w-5" />
        <span className="sr-only">{LIBELLE_FERMER}</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = 'DialogContent';

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      // `sticky top-0` : reste visible en haut du corps défilable pendant que le reste défile
      // dessous (le patron « en-tête fixe / corps défilable / pied fixe » demandé par l'issue
      // #67). `bg-background` + `z-10` : sans fond opaque ni empilement au-dessus du contenu
      // suivant, le contenu défilé apparaîtrait à travers l'en-tête au lieu de disparaître
      // derrière lui.
      className={cn('sticky top-0 z-10 flex flex-col gap-champ bg-background text-left', className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      // `sticky bottom-0` : le pied d'actions (ex. « Confirmer ») reste toujours dans le
      // viewport pendant que le corps défile — c'est la correction directe du défaut mesuré
      // (bouton de validation inatteignable, issue #67).
      className={cn(
        'sticky bottom-0 z-10 flex flex-col-reverse gap-controles bg-background sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}

export const DialogTitle = forwardRef<
  ElementRef<typeof DialogPrimitive.Title>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('texte-titre-section leading-none text-foreground', className)}
    {...props}
  />
));
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = forwardRef<
  ElementRef<typeof DialogPrimitive.Description>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('texte-corps text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = 'DialogDescription';
