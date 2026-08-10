import { Snowflake, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { SaisonPneu } from '@dfa/shared';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface Props {
  readonly saison: SaisonPneu;
  readonly className?: string;
}

/**
 * Été/hiver est une dimension MÉTIER, pas un statut : le Lot K a posé les tokens `--statut-*`
 * (six, réservés à l'état d'un OR/d'une ligne) et `--avertissement-*`, mais volontairement aucun
 * `--saison-*` — l'arbitrage est laissé ouvert au composant qui en a besoin. Plutôt que
 * d'inventer une paire de couleurs hors système (qu'il faudrait faire vérifier au contraste et
 * maintenir hors de `index.css`), la lecture « d'un coup d'œil, sans lire de texte » (spec §6)
 * passe par la FORME : icône distincte (`Sun`/`Snowflake`) + libellé traduit, sur le `Badge`
 * neutre du système (`components/ui/badge.tsx`, variante `outline`). C'est la même règle
 * qu'ailleurs dans le produit — la couleur seule ne porte jamais l'information (daltonisme) —
 * appliquée ici sans même s'appuyer sur la couleur.
 *
 * Aucun mode sombre dans ce produit (`index.css`, tranché au Lot K — « aucune variante `dark:` ne
 * doit exister dans le produit », une classe `.dark` n'étant appliquée nulle part) : ce composant
 * n'en porte donc aucune.
 */
export function BadgeSaisonPneu({ saison, className }: Props) {
  const { t } = useTranslation('pneus');
  const estEte = saison === 'ete';

  return (
    <Badge variant="outline" className={cn('gap-1', className)}>
      {estEte ? (
        <Sun className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <Snowflake className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {t(`pneus:saison.${saison}`)}
    </Badge>
  );
}
