import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CLASSES_SEPARATOR_MENU } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

// `shouldFilter={false}` par défaut : la recherche par plaque/châssis/nom interroge l'API, ce
// n'est jamais un simple filtre client sur une liste déjà chargée — c'est pourquoi l'ancienne
// implémentation maison (voir docs/design-comptoir.md §3) ne filtrait pas non plus. Un appelant
// qui a une vraie liste statique à filtrer côté client peut repasser `shouldFilter` à `true`.
export const Command = forwardRef<
  ElementRef<typeof CommandPrimitive>,
  ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, shouldFilter = false, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    shouldFilter={shouldFilter}
    className={cn(
      'flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground',
      className,
    )}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

export interface ProprietesCommandDialog extends ComponentPropsWithoutRef<typeof Dialog> {
  /** Nom accessible de la boîte de dialogue, lu par les lecteurs d'écran (rendu `sr-only`, sans
   *  équivalent visible — une palette de commandes n'a pas de titre visuel). Pas de valeur par
   *  défaut ici à dessein : cette primitive n'a pas de contexte i18n (voir `LIBELLE_FERMER` dans
   *  `dialog.tsx`), donc c'est à l'écran appelant de fournir la clé traduite.
   */
  readonly title: string;
  readonly description: string;
}

// L'absence de titre/description accessibles ici était un défaut latent : `DialogContent` exige
// un `DialogTitle` (avertissement Radix en son absence) et, sans lui, un lecteur d'écran annonce
// la boîte de dialogue sans nom. Correctif inspiré de
// https://github.com/cosscom/coss/blob/main/apps/origin/registry/default/ui/command.tsx
// (Origin UI historique, licence MIT) — adapté : titre/description passent par l'i18n de
// l'appelant (pas de chaîne anglaise en dur), et le bouton de fermeture par défaut de
// `DialogContent` (cible tactile 44 px, voir dialog.tsx) reste visible — Origin le masque, mais
// ce produit n'a aucun renoncement possible au clavier/à la souris sur tablette.
export function CommandDialog({ title, description, children, ...props }: ProprietesCommandDialog) {
  return (
    <Dialog {...props}>
      <DialogContent className="overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Command className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:texte-libelle [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

export const CommandInput = forwardRef<
  ElementRef<typeof CommandPrimitive.Input>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Input>
>(({ className, ...props }, ref) => (
  <div
    className="flex items-center gap-2 border-b px-3 transition-colors focus-within:border-ring"
    cmdk-input-wrapper=""
  >
    <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
    <CommandPrimitive.Input
      ref={ref}
      className={cn(
        'flex h-11 w-full bg-transparent py-3 text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  </div>
));
CommandInput.displayName = CommandPrimitive.Input.displayName;

export const CommandList = forwardRef<
  ElementRef<typeof CommandPrimitive.List>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={cn('max-h-80 overflow-y-auto overflow-x-hidden p-1', className)}
    {...props}
  />
));
CommandList.displayName = CommandPrimitive.List.displayName;

export const CommandEmpty = forwardRef<
  ElementRef<typeof CommandPrimitive.Empty>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className="py-6 text-center texte-corps text-muted-foreground"
    {...props}
  />
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

export const CommandGroup = forwardRef<
  ElementRef<typeof CommandPrimitive.Group>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={cn(
      'overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:texte-libelle [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground',
      className,
    )}
    {...props}
  />
));
CommandGroup.displayName = CommandPrimitive.Group.displayName;

export const CommandSeparator = forwardRef<
  ElementRef<typeof CommandPrimitive.Separator>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={cn(CLASSES_SEPARATOR_MENU, className)}
    {...props}
  />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

export const CommandItem = forwardRef<
  ElementRef<typeof CommandPrimitive.Item>,
  ComponentPropsWithoutRef<typeof CommandPrimitive.Item>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={cn(
      'element-menu relative flex min-h-11 cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-2 texte-corps outline-none',
      'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
      className,
    )}
    {...props}
  />
));
CommandItem.displayName = CommandPrimitive.Item.displayName;
