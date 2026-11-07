import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

type PropsContenu = Pick<
  ComponentPropsWithoutRef<typeof SheetContent>,
  'onEscapeKeyDown' | 'onPointerDownOutside' | 'onInteractOutside'
>;

interface Props extends PropsContenu {
  readonly ouvert: boolean;
  readonly onOuvertChange: (ouvert: boolean) => void;
  readonly titre: string;
  /** Texte d'aide sous le titre ; absent = aucune description. */
  readonly description?: string;
  /** Contenu (formulaire) : seule zone qui défile. */
  readonly children: ReactNode;
  /** Boutons d'action, alignés à droite, toujours visibles en bas. Pour un `<form>` dans le
   *  contenu, donner aux boutons `form="id-du-formulaire"`. */
  readonly pied?: ReactNode;
  readonly className?: string;
}

/**
 * Panneau latéral droit unique pour toute saisie (création, modification) : largeur fixe
 * 480-560 px, plein écran sur téléphone. Les confirmations restent des petites boîtes centrées
 * (`AvertissementConfirmable`) — seules les saisies passent ici. Pose `Sheet` Radix (focus,
 * Échap, aria) : aucun comportement réinventé.
 */
export function PanneauLateral({
  ouvert,
  onOuvertChange,
  titre,
  description,
  children,
  pied,
  className,
  ...evenements
}: Props) {
  return (
    <Sheet open={ouvert} onOpenChange={onOuvertChange}>
      <SheetContent
        side="right"
        className={cn('w-full gap-0 p-0 sm:w-[34rem] sm:max-w-[35rem]', className)}
        {...(description ? {} : { 'aria-describedby': undefined })}
        {...evenements}
      >
        <SheetHeader className="p-carte pb-3">
          <SheetTitle>{titre}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <div className="px-carte pb-carte">{children}</div>
        {pied ? (
          <SheetFooter className="mt-auto flex-row justify-end gap-controles border-t p-carte">
            {pied}
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
