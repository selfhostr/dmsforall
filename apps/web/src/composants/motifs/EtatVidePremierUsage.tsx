import type { ReactNode } from 'react';

import { EtatVide } from '@/composants/commun/EtatVide';

interface Props {
  readonly titre: string;
  readonly description: string;
  /** Généralement l'action de création (« Nouveau client », « Nouveau véhicule »), transmise déjà
   *  traduite par l'écran appelant — même contrat que `EtatVide`. */
  readonly action?: ReactNode;
}

/** État vide « première utilisation » — aucun enregistrement n'existe encore, indépendamment de
 *  tout filtre/recherche. Utilisé quand la liste est vide ET qu'aucune recherche/filtre n'est
 *  actif (docs/design-comptoir.md §4 : « `EtatVideRecherche` si un filtre/une recherche est
 *  actif, `EtatVidePremierUsage` sinon »). */
export function EtatVidePremierUsage({ titre, description, action }: Props) {
  return <EtatVide titre={titre} description={description} action={action} />;
}
