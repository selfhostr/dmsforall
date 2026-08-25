import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';

import { CLASSES_CHAMP } from '@/components/ui/classes-champ';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

// API composée standard shadcn (Select/SelectTrigger/SelectValue/SelectContent/SelectItem),
// à la différence de l'ancienne implémentation maison sur <select> natif (voir
// docs/design-comptoir.md §3) : changement d'appel assumé, documenté comme tel dans ce même
// document.

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = forwardRef<
  ElementRef<typeof SelectPrimitive.Trigger>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    // Habillage et cinq états partagés avec Input/Textarea/DateInput : voir `classes-champ.ts`.
    // Avant le Lot K, ce déclencheur posait `focus:outline-none` là où `Input` posait
    // `focus-visible:outline-none` — deux champs voisins d'un même formulaire n'avaient pas le
    // même comportement de focus.
    className={cn(
      CLASSES_CHAMP,
      'h-11 items-center justify-between [&>span]:line-clamp-1',
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

export const SelectContent = forwardRef<
  ElementRef<typeof SelectPrimitive.Content>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = 'popper', ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      className={cn(
        'relative z-50 max-h-96 min-w-[8rem] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-md',
        position === 'popper' &&
          'translate-y-1 data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
        className,
      )}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          'p-1',
          position === 'popper' &&
            'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]',
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = SelectPrimitive.Content.displayName;

// Repris de https://github.com/cosscom/coss (apps/origin, Origin UI historique — licence MIT) —
// absents de l'implémentation précédente. Sur une longue liste (marques/modèles, sites,
// techniciens), le `Viewport` ci-dessus défile déjà à la molette/au doigt, mais sans indice
// visuel qu'il y a plus d'options au-delà du cadre visible ; la navigation clavier (flèches) peut
// aussi pousser la sélection hors du viewport visible sans bouton pour y revenir explicitement.
// Ces deux boutons apparaissent uniquement quand Radix détecte un débordement réel
// (`SelectPrimitive.Scroll*Button` ne se monte que si nécessaire) : rien de visible sur les
// listes courtes qui composent la majorité des `<Select>` du produit.
export const SelectScrollUpButton = forwardRef<
  ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      'flex cursor-default items-center justify-center py-1 text-muted-foreground',
      className,
    )}
    {...props}
  >
    <ChevronUp aria-hidden="true" className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

export const SelectScrollDownButton = forwardRef<
  ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      'flex cursor-default items-center justify-center py-1 text-muted-foreground',
      className,
    )}
    {...props}
  >
    <ChevronDown aria-hidden="true" className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

export const SelectLabel = forwardRef<
  ElementRef<typeof SelectPrimitive.Label>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn('px-2 py-1.5 texte-libelle font-medium', className)}
    {...props}
  />
));
SelectLabel.displayName = SelectPrimitive.Label.displayName;

export const SelectItem = forwardRef<
  ElementRef<typeof SelectPrimitive.Item>,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      // `texte-corps` (pas `text-base` brut) : aligne l'option de liste sur `CommandItem`
      // (`command.tsx`) et `DropdownMenuItem` (`dropdown-menu.tsx`), les deux autres primitives
      // « ligne d'un menu déroulant » du produit, qui portent déjà ce rôle. Avant ce correctif,
      // ouvrir un `<Select>` puis un `<Command>` sur le même écran dense montrait deux tailles
      // d'option (16px vs 14px) pour un rôle identique. `SelectTrigger` reste volontairement fixé
      // à 16px (`CLASSES_CHAMP`, anti-zoom iPad) : seul le contenu du menu change ici.
      'element-menu relative flex min-h-11 w-full cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 texte-corps outline-none',
      'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check aria-hidden="true" className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = SelectPrimitive.Item.displayName;

// Composé sur le `Separator` partagé (`components/ui/separator.tsx`) plutôt que sur
// `SelectPrimitive.Separator` : ce dernier n'apporte rien de plus (même rôle ARIA décoratif,
// aucune inscription dans la navigation clavier des `SelectItem`) et dupliquait la même classe
// que `DropdownMenuSeparator` — voir le commentaire de tête de `separator.tsx`.
export const SelectSeparator = forwardRef<
  ElementRef<typeof Separator>,
  ComponentPropsWithoutRef<typeof Separator>
>(({ className, ...props }, ref) => (
  <Separator ref={ref} className={cn('-mx-1 my-1', className)} {...props} />
));
SelectSeparator.displayName = 'SelectSeparator';
