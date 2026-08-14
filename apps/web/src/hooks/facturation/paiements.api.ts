import type {
  EntreeCreationPaiement,
  ReponseAvecAvertissements,
  ReponsePaiement,
} from '@dfa/shared';

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

/**
 * `POST /paiements` — `Idempotency-Key` OBLIGATOIRE (consigne explicite de @laupernoe sur toute création
 * sensible). `imputations` embarquées : l'écran d'encaissement lettre en un seul geste (`RF-69`).
 *
 * DÉFAUT CORRIGÉ (testeur novice, encaissement de Meier Urs, 60.00 CHF, message rouge
 * « L'opération n'a pas pu être effectuée. Réessayez. » sur un paiement en réalité DÉJÀ enregistré
 * côté serveur) : `PaiementController.creer` répond `PaiementAvecAvertissementsDto`, une
 * ENVELOPPE `{ donnees, avertissements }` — même convention que `emettreDocumentVente`/
 * `creerAvoir` ci-dessus (`documents-vente.api.ts`), toutes deux typées
 * `ReponseAvecAvertissements<...>` et unwrappées via `.donnees`. Cette fonction typait
 * autrefois `requeteApi<ReponsePaiement>` DIRECTEMENT (le type INTERNE, pas l'enveloppe) et
 * retournait l'enveloppe telle quelle : `useEncaissement.onSuccess`, qui lit
 * `paiement.imputations`, lisait donc `undefined` sur CHAQUE encaissement réussi — `for...of
 * undefined` lève un `TypeError`, capturé par `mutateAsync`, qui REJETAIT alors une requête dont
 * le serveur avait pourtant créé le paiement avec succès. `messageErreur` retombe sur son repli
 * générique (`erreurs:inattendue.description`) faute de reconnaître ce `TypeError` — exactement
 * le message observé. Preuve : `POST /paiements` réel (API tournante) répond bien
 * `{"donnees":{...},"avertissements":[]}`, jamais l'objet nu.
 */
export async function creerPaiement(
  entree: EntreeCreationPaiement,
  idempotencyKey: string,
): Promise<ReponsePaiement> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponsePaiement>>('/paiements', {
    method: 'POST',
    body: JSON.stringify(entree),
    idempotencyKey,
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /paiements.');
  }
  return reponse.donnees;
}
