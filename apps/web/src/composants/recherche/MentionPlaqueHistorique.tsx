import { History } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { formaterDate } from '@/lib/formats';

interface ProprietesMentionPlaqueHistorique {
  readonly nomClient: string;
  /** Date ISO jusqu'à laquelle la plaque a été portée (`porteeJusquLe`). */
  readonly porteeJusquLe: string;
}

/**
 * CT-05 / RM-17 : une plaque réattribuée reste rattachée à son ancien véhicule. Ce résultat doit
 * être distinct **visuellement et sémantiquement** du véhicule courant — `role="note"` (contenu
 * annexe/explicatif, jamais confondu avec le résultat principal par un lecteur d'écran) en plus
 * du style atténué, jamais la couleur seule.
 */
export function MentionPlaqueHistorique({ nomClient, porteeJusquLe }: ProprietesMentionPlaqueHistorique) {
  const { t } = useTranslation('recherche');

  return (
    <span role="note" className="flex items-center gap-1.5 texte-libelle italic text-muted-foreground">
      <History aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {t('details.plaqueHistorique', { client: nomClient, date: formaterDate(porteeJusquLe) })}
    </span>
  );
}
