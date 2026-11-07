import { Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface ProprietesBarreFiltres {
  readonly q: string;
  readonly onChangeQ: (q: string) => void;
  readonly placeholderRecherche?: string;
  /** Filtres (sélecteurs, cases) : rangés à droite de la recherche, sur la même ligne. */
  readonly children?: ReactNode;
  /** Bouton de tri (`SelecteurTri`), en bout de ligne. */
  readonly tri?: ReactNode;
  /** @deprecated Le bouton « Effacer les filtres » n'existe plus : on revient à « Tous… » par
   *  les filtres eux-mêmes. Prop conservée, ignorée, le temps que tous les appelants migrent. */
  readonly filtresActifs?: boolean;
  /** @deprecated Voir `filtresActifs`. */
  readonly onEffacerFiltres?: () => void;
  readonly className?: string;
}

/**
 * Barre de recherche + filtres + tri d'une liste : UNE seule ligne tant que la place suffit. Quand elle manque,
 * la recherche rétrécit jusqu'à 8 rem, puis les filtres passent proprement à la ligne (jamais de
 * chevauchement ni de débordement). Tous les contrôles ont la même hauteur (44 px) et l'alignement est celui de la grille
 * de la page : pas de libellé au-dessus, donc rien qui décale.
 */
export function BarreFiltres({
  q,
  onChangeQ,
  placeholderRecherche,
  children,
  tri,
  className,
}: ProprietesBarreFiltres) {
  const { t } = useTranslation('commun');

  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <div className="relative min-w-[8rem] max-w-md flex-1 basis-48">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          className="pl-9"
          placeholder={placeholderRecherche ?? t('commun:actions.rechercher')}
          aria-label={t('commun:actions.rechercher')}
          value={q}
          onChange={(evenement) => onChangeQ(evenement.target.value)}
        />
      </div>
      {children}
      {tri ? <div className="ml-auto shrink-0">{tri}</div> : null}
    </div>
  );
}
