import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface ProprietesBoutonIconeInfobulle {
  /** Libellé explicite : sert à la fois d'infobulle (survol ET focus clavier) et d'`aria-label`. */
  readonly libelle: string;
  readonly icone: LucideIcon;
  /** Navigation (lien) ; à défaut, `onClick` (bouton). */
  readonly to?: string;
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  readonly className?: string;
}

/**
 * Bouton carré blanc (variante `outline`, 44 px) avec une icône seule, un nom accessible et une
 * infobulle identique au nom. À utiliser pour les actions de barre d'outils dont l'icône est claire
 * (créer, basculer liste/plan…) : jamais de texte à côté, l'infobulle porte la précision.
 */
export function BoutonIconeInfobulle({
  libelle,
  icone: Icone,
  onClick,
  to,
  disabled,
  className,
}: ProprietesBoutonIconeInfobulle) {
  const contenu = <Icone aria-hidden className="h-5 w-5" />;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {to !== undefined ? (
          <Button asChild variant="outline" size="icon" className={className}>
            <Link to={to} aria-label={libelle}>
              {contenu}
            </Link>
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={className}
            aria-label={libelle}
            disabled={disabled}
            onClick={onClick}
          >
            {contenu}
          </Button>
        )}
      </TooltipTrigger>
      <TooltipContent>{libelle}</TooltipContent>
    </Tooltip>
  );
}
