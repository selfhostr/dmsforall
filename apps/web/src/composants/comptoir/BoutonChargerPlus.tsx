import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ProprietesBoutonChargerPlus {
  /** `true` tant que `curseurSuivant` (PageCurseur, @dfa/shared) n'est pas `null`. Ce
   *  composant implémente le curseur, jamais des numéros de page (F1-U6 « Done »). */
  readonly aChargerPlus: boolean;
  readonly enChargement?: boolean;
  readonly onChargerPlus: () => void;
  readonly className?: string;
}

/** Pied de liste à curseur : « Charger plus » tant qu'il reste une page, rien une fois la fin
 *  de liste atteinte (pas de bouton désactivé qui traîne). */
export function BoutonChargerPlus({ aChargerPlus, enChargement = false, onChargerPlus, className }: ProprietesBoutonChargerPlus) {
  const { t } = useTranslation('commun');

  if (!aChargerPlus) return null;

  return (
    <div className={cn('flex justify-center py-2', className)}>
      <Button type="button" variant="outline" disabled={enChargement} onClick={onChargerPlus}>
        {enChargement ? t('commun:chargement.enCours') : t('commun:actions.chargerPlus')}
      </Button>
    </div>
  );
}
