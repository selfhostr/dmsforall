import * as LabelPrimitive from '@radix-ui/react-label';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface ProprietesLabel extends ComponentPropsWithoutRef<typeof LabelPrimitive.Root> {
  /** Marque le champ associé comme obligatoire — étoile visuelle + accessible. Le champ LUI-MÊME
   *  doit encore porter `required` (natif) ou `aria-required="true"` (ex. Radix `Select`/
   *  `Checkbox`, qui n'exposent pas `required`) : l'étoile seule est `aria-hidden`, un lecteur
   *  d'écran ne l'annonce jamais. Un formulaire qui utilise cette prop doit afficher UNE FOIS
   *  `LegendeChampsObligatoires` — jamais l'étoile sans elle, sinon un garagiste voit un symbole
   *  qu'on ne lui a jamais expliqué. */
  readonly requis?: boolean;
}

export const Label = forwardRef<ElementRef<typeof LabelPrimitive.Root>, ProprietesLabel>(
  ({ className, requis, children, ...props }, ref) => (
    <LabelPrimitive.Root
      ref={ref}
      className={cn(
        'texte-corps font-medium leading-none text-foreground',
        // `text-muted-foreground` plutôt qu'`opacity-70` : un libellé doit rester LISIBLE quand
        // son champ est désactivé (il nomme une valeur qu'on doit encore pouvoir lire), il doit
        // seulement paraître inactif. À 70 % d'opacité il tombait à 2.9:1.
        'peer-disabled:cursor-not-allowed peer-disabled:text-muted-foreground',
        className,
      )}
      {...props}
    >
      {children}
      {requis ? (
        // `aria-hidden` : le lecteur d'écran ne doit JAMAIS annoncer « astérisque », qui ne veut
        // rien dire à l'oreille — c'est `required`/`aria-required` posé sur le CHAMP qui porte
        // l'information accessible, ce symbole n'est qu'un rappel visuel.
        <span aria-hidden="true" className="ml-0.5 text-destructive">
          *
        </span>
      ) : null}
    </LabelPrimitive.Root>
  ),
);
Label.displayName = LabelPrimitive.Root.displayName;

/**
 * Légende « Les champs marqués d'une étoile sont obligatoires » — UNE FOIS par formulaire (pas
 * par champ), juste après le titre ou au-dessus du premier champ. Ce composant ne porte PAS le
 * texte lui-même (générique EN, `components/ui/` — voir CONTRIBUTING.md) : chaque écran fournit sa
 * propre traduction (`t('commun:formulaires.champsObligatoiresLegende')`), ce composant ne fixe
 * que la présentation partagée.
 */
export function LegendeChampsObligatoires({
  className,
  children,
}: {
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return <p className={cn('texte-libelle text-muted-foreground', className)}>{children}</p>;
}
