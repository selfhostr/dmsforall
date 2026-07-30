import type { EntreeCreationPaiement, ReponsePaiement } from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Couche transport des paiements (écran 3 — Encaissement). Même réserve que
 * `documents-vente.api.ts` : endpoints déduits des commentaires de `packages/shared/src/contrats/
 * facturation/paiement.ts`, l'OpenAPI de la facturation n'étant pas encore générée.
 *
 * `POST /paiements/{id}/imputations`, `/rembourser` et `/abandonner` (gestion de l'avance client,
 * `RF-79`) ne sont volontairement PAS câblés ici : aucun des cinq écrans demandés ne les déclenche
 * (l'écran 3 ne fait qu'AFFICHER l'existence d'une avance à venir, §5.3 du design — il ne propose
 * pas encore de la solder). À ajouter au lot qui construira l'écran dédié à ces trois issues.
 */

/** `POST /paiements` — `Idempotency-Key` OBLIGATOIRE (consigne explicite de @laupernoe sur toute création
 *  sensible). `imputations` embarquées : l'écran d'encaissement lettre en un seul geste (`RF-69`). */
export async function creerPaiement(entree: EntreeCreationPaiement, idempotencyKey: string): Promise<ReponsePaiement> {
  const paiement = await requeteApi<ReponsePaiement>('/paiements', {
    method: 'POST',
    body: JSON.stringify(entree),
    idempotencyKey,
  });
  if (!paiement) {
    throw new Error('Réponse vide inattendue : POST /paiements.');
  }
  return paiement;
}
