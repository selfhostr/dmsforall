import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { EtatVide } from '@/composants/commun/EtatVide';

interface Props {
  readonly titre: string;
  readonly description: string;
  /** Quand fourni, ajoute automatiquement l'action « Effacer les filtres »
   *  (`commun:actions.effacerFiltres`) — le repli standard d'un état vide filtré. */
  readonly onEffacerFiltres?: () => void;
}

/** État vide « filtre » — des filtres structurés (statut, type…) sont actifs et ne remontent
 *  aucun résultat, distinct d'une recherche texte libre (`EtatVideRecherche`) : ici la sortie
 *  naturelle est d'effacer les filtres, d'où l'action intégrée par défaut. */
export function EtatVideFiltre({ titre, description, onEffacerFiltres }: Props) {
  const { t } = useTranslation('commun');

  return (
    <EtatVide
      titre={titre}
      description={description}
      action={
        onEffacerFiltres ? (
          <Button variant="outline" onClick={onEffacerFiltres}>
            {t('commun:actions.effacerFiltres')}
          </Button>
        ) : undefined
      }
    />
  );
}
