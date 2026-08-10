import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import { type ButtonHTMLAttributes, type ReactNode, forwardRef } from 'react';

import { cn } from '@/lib/utils';

// Hauteurs relevées par rapport au gabarit shadcn par défaut : cibles tactiles >=44px
// obligatoires (tablette d'atelier), voir CONTRIBUTING.md / contrat frontend étape 0.
//
// Les cinq états sont ici et nulle part ailleurs :
//   repos / survol (`hover:bg-*-fort`) / focus (`.anneau-focus`) / désactivé
//   (`disabled:*`) / chargement (prop `enChargement`, voir plus bas).
//
// SURVOL — le fond FONCE (`primary-fort`, `destructive-fort`) au lieu de s'éclaircir via une
// opacité (`bg-primary/90`). Deux raisons : une opacité fait dépendre la couleur obtenue de
// ce qu'il y a derrière le bouton (un bouton sur fond `--muted` ne prenait pas la même teinte
// que le même bouton sur fond blanc), et un appui doit se lire comme un enfoncement, pas
// comme un effacement. Contraste du blanc sur `--primary-fort` : 11.29:1.
const variantesBouton = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium',
    'transition-colors anneau-focus',
    'disabled:pointer-events-none disabled:opacity-50',
    'aria-busy:cursor-progress',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary-fort',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive-fort',
        outline: 'border border-input bg-background hover:border-marque hover:bg-muted',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-muted',
        link: 'text-primary underline-offset-4 hover:text-primary-fort hover:underline',
      },
      size: {
        default: 'h-11 px-4 py-2',
        // 40 px visibles, 44 px cliquables : le pseudo-élément déborde de 2 px en haut et en
        // bas pour tenir la règle des 44 px sans imposer un bouton de 44 px de haut dans une
        // barre d'outils dense de comptoir. La zone étendue est invisible et n'occupe aucune
        // place dans le flux — elle ne peut donc pas décaler la mise en page.
        sm: 'relative h-10 rounded-md px-3 after:absolute after:inset-x-0 after:-inset-y-0.5 after:content-[""]',
        lg: 'h-12 rounded-md px-8',
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof variantesBouton> {
  asChild?: boolean;
  /**
   * Action en cours (envoi d'un formulaire, appel serveur). Le bouton devient inactif, expose
   * `aria-busy` au lecteur d'écran et remplace son icône de tête par un indicateur d'attente.
   *
   * C'est le SEUL état de chargement d'un bouton dans le produit : un écran ne doit pas
   * inventer son propre `{enCours ? <Loader2 /> : null}`, sinon chaque écran a sa taille de
   * roue, sa position et son `aria-*` — ou n'en a pas. Le libellé reste affiché et inchangé
   * (jamais « Envoi… » à la place de « Facturer ») : un bouton dont le texte change de
   * longueur pendant qu'on clique dessus se déplace sous le doigt.
   */
  enChargement?: boolean;
  /** Icône de tête, placée avant le libellé. Remplacée par l'indicateur pendant le chargement. */
  icone?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      asChild = false,
      enChargement = false,
      icone,
      children,
      disabled,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : 'button';

    // `asChild` délègue le rendu à l'enfant unique attendu par Slot : y injecter une roue et
    // un fragment casserait ce contrat. L'état reste donc annoncé (`aria-busy`, `disabled`)
    // mais sans décoration — un `asChild` sert à rendre un lien de navigation, pas un bouton
    // qui envoie un formulaire.
    const contenu = asChild ? (
      children
    ) : (
      <>
        {enChargement ? (
          <LoaderCircle aria-hidden="true" className="indicateur-chargement h-4 w-4" />
        ) : (
          icone
        )}
        {children}
      </>
    );

    // `|| undefined` et non `?? enChargement` : un appelant qui passe explicitement
    // `disabled={false}` ne doit pas pouvoir réactiver un bouton en cours d'envoi, et un
    // `disabled={false}` posé sur un `<a>` par `asChild` produirait un attribut invalide.
    const attributsEtat: ButtonHTMLAttributes<HTMLButtonElement> = {
      disabled: disabled || enChargement || undefined,
      'aria-busy': enChargement || undefined,
    };

    return (
      <Comp
        className={cn(variantesBouton({ variant, size, className }))}
        ref={ref}
        {...attributsEtat}
        {...props}
      >
        {contenu}
      </Comp>
    );
  },
);
Button.displayName = 'Button';
