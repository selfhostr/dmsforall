import { useTranslation } from 'react-i18next';

import { EtatVide } from '@/composants/commun/EtatVide';

/** État vide assumé à l'étape 0 : pas de clients, pas d'atelier, pas de bouton d'action —
 *  il n'y a rien à créer tant que le module Atelier + Clients n'existe pas. Un bouton
 *  d'action ici mentirait sur ce que l'app sait déjà faire. */
export function EcranAccueil() {
  const { t } = useTranslation('accueil');

  return (
    <EtatVide
      titre={t('accueil:vide.titre')}
      description={t('accueil:vide.description')}
      note={t('accueil:vide.prochaineEtape')}
    />
  );
}
