import { Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';

interface Props {
  readonly q: string;
  readonly onChangeQ: (q: string) => void;
  readonly placeholderRecherche: string;
  /** Filtres du domaine (sélecteurs), à la suite de la recherche. */
  readonly filtres?: ReactNode;
  /** Contrôles alignés à droite : tri, bascule d'affichage, action principale. */
  readonly droite?: ReactNode;
}

/**
 * Rangée unique des listes de ventes : recherche, filtres, puis tri/actions à droite. Pas de
 * bouton « Effacer les filtres » (revenir à « Tous… » suffit). Se replie sur plusieurs lignes
 * sous `md` seulement. Local à `ventes/` en attendant le composant commun de
 * `fix/epuration-interface`.
 */
export function BarreOutilsVentes({ q, onChangeQ, placeholderRecherche, filtres, droite }: Props) {
  const { t } = useTranslation('commun');
  return (
    <div className="flex flex-wrap items-center gap-2 md:flex-nowrap">
      <div className="relative min-w-40 max-w-64 flex-1">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          className="pl-9"
          placeholder={placeholderRecherche}
          aria-label={t('commun:actions.rechercher')}
          value={q}
          onChange={(evenement) => onChangeQ(evenement.target.value)}
        />
      </div>
      {filtres}
      {droite ? <div className="ml-auto flex shrink-0 items-center gap-2">{droite}</div> : null}
    </div>
  );
}
