import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import type { ReponseEnvoiRelances } from '@dfa/shared';

import { envoyerRelancesFacture } from './relances.api';

/**
 * `POST /relances/facturation/envoyer` — opération APPELABLE à la demande. Un lot borné par appel
 * (`encoreATraiter` signale s'il en reste). Sans connecteur `NotificationSender` actif, l'API rend
 * un lot vide, jamais une erreur (voir le contrôleur) : l'écran affiche alors « 0 envoyé »,
 * comportement normal, pas un échec.
 */
export function useEnvoyerRelances(): UseMutationResult<ReponseEnvoiRelances, unknown, void> {
  return useMutation({
    mutationFn: () => envoyerRelancesFacture(),
  });
}
