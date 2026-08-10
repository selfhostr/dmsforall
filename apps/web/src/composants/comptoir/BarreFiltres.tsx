import { Search, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface ProprietesBarreFiltres {
  readonly q: string;
  readonly onChangeQ: (q: string) => void;
  /** Défaut : `commun:actions.rechercher`. */
  readonly placeholderRecherche?: string;
  /** Contrôles de filtre du domaine (selects, cases…), déjà traduits par l'appelant. */
  readonly children?: ReactNode;
  /** `true` si au moins un filtre (recherche incluse) est actif — pilote l'activation du
   *  bouton « Effacer les filtres ». */
  readonly filtresActifs: boolean;
  readonly onEffacerFiltres: () => void;
  readonly className?: string;
}

/** Barre de filtres du comptoir : recherche + contrôles du domaine + effacement en un geste.
 *  Composant purement contrôlé — aucun debounce interne (reste à l'appelant/au hook de
 *  recherche, voir F1-R2), aucune requête ici. */
export function BarreFiltres({
  q,
  onChangeQ,
  placeholderRecherche,
  children,
  filtresActifs,
  onEffacerFiltres,
  className,
}: ProprietesBarreFiltres) {
  const { t } = useTranslation('commun');

  return (
    <div className={cn('flex flex-wrap items-end gap-3', className)}>
      <div className="relative min-w-[220px] flex-1">
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
      <Button type="button" variant="ghost" disabled={!filtresActifs} onClick={onEffacerFiltres}>
        <X aria-hidden className="h-4 w-4" />
        {t('commun:actions.effacerFiltres')}
      </Button>
    </div>
  );
}
