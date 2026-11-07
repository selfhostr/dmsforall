import { MoreHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface ActionSecondaireMenu {
  readonly cle: string;
  readonly libelle: string;
  readonly onSelect: () => void;
}

interface Props {
  /**
   * L'action primaire elle-même — UN SEUL élément interactif (`Button`, `Link`, ou déclencheur de
   * dialogue tel que `DialogueAjoutLigneOr`), déjà entièrement construit par l'appelant. Ce
   * composant ne connaît ni sa nature ni son état — seulement sa POSITION (Lot C,
   * `docs/plan-refonte-navigation.md` : « une seule action mise en couleur, visible à un endroit
   * constant »). Chaque écran garde la responsabilité de décider quelle est SON action primaire
   * (voir `EnTeteOrdreReparation`/`EnTeteDossierVente`/`EnTeteFicheArticle`) à partir du signal
   * déjà calculé côté serveur (ex. `or.actionsDisponibles`), jamais d'une règle redevinée ici —
   * patron composition plutôt que prop booléenne (vercel-composition-patterns).
   */
  readonly children: ReactNode;
  /** Le reste des actions, derrière un « … » — absent ou vide : aucun menu rendu (un écran sans
   *  action secondaire n'affiche pas un déclencheur qui ouvrirait un menu vide). */
  readonly actionsSecondaires?: readonly ActionSecondaireMenu[];
  /** `aria-label` du déclencheur « … » — à fournir dès qu'`actionsSecondaires` est non vide. */
  readonly libelleMenuSecondaire?: string;
  /** Boutons complémentaires, rendus entre l'action primaire et le « … » : le menu reste
   *  toujours le dernier élément de la rangée. */
  readonly complements?: ReactNode;
  readonly className?: string;
}

/**
 * Emplacement constant de l'action primaire d'un écran (Lot C) : l'action elle-même, plus un
 * déclencheur « … » optionnel pour tout le reste. `Button` par défaut (`size="default"`, `h-11`)
 * garantit déjà la cible tactile >=44px du dépôt (tablette d'atelier).
 */
export function ActionPrimaire({
  children,
  actionsSecondaires = [],
  libelleMenuSecondaire,
  complements,
  className,
}: Props) {
  return (
    <div className={cn('flex shrink-0 items-center gap-2', className)}>
      {children}
      {complements}
      {actionsSecondaires.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label={libelleMenuSecondaire}>
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {actionsSecondaires.map((action) => (
              <DropdownMenuItem key={action.cle} onSelect={action.onSelect}>
                {action.libelle}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
