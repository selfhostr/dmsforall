import { Snowflake, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { SaisonPneu } from '@dfa/shared';

import { cn } from '@/lib/utils';

interface Props {
  readonly saison: SaisonPneu;
  readonly className?: string;
}

/**
 * Code couleur été/hiver « d'un coup d'œil, sans lire de texte » (exigence de l'écran, spec §6) :
 * icône + couleur distincte, le libellé traduit reste présent pour l'accessibilité (jamais une
 * icône seule sans équivalent texte) mais n'est PAS ce qui porte la lecture rapide.
 *
 * Couleurs fixes (ambre/orange = été, bleu = hiver) — volontairement PAS dérivées des tokens
 * `primary`/`secondary` du thème (qui n'ont aucune association saisonnière) : un garagiste doit
 * reconnaître la couleur AVANT de lire, même en mode sombre (`dark:` posé explicitement).
 */
export function BadgeSaisonPneu({ saison, className }: Props) {
  const { t } = useTranslation('pneus');
  const estEte = saison === 'ete';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        estEte
          ? 'border-amber-300 bg-amber-100 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200'
          : 'border-sky-300 bg-sky-100 text-sky-900 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-200',
        className,
      )}
    >
      {estEte ? (
        <Sun className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <Snowflake className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {t(`pneus:saison.${saison}`)}
    </span>
  );
}
