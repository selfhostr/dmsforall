import type {
  EntreeFacturationOrdreReparation,
  ReponseAvecAvertissements,
  ReponseFacturationOrdreReparation,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * `POST /ordres-reparation/{orId}/facturer` (`RF-81`) — contrat désormais GELÉ dans
 * `packages/shared/src/contrats/facturation/facturer-or.ts` (`EntreeFacturationOrdreReparation`,
 * `ReponseFacturationOrdreReparation`). Les types locaux provisoires que cette fonction exposait
 * auparavant (`payeurs: PayeurLigneOr[]`, `motifsReportParPayeur`, réponse `{ brouillons }`) ont
 * disparu : ce fichier importe désormais le contrat réel, comme toute autre couche `*.api.ts` de ce
 * module — voir l'historique git pour le détail de l'écart d'origine, résolu.
 *
 * `Idempotency-Key` OBLIGATOIRE (même patron que toute création de document de vente) : l'empreinte
 * porte sur le corps canonicalisé, `confirmations` compris — voir `useFacturationOrdreReparation.ts`
 * pour l'orchestration (régénération de la clé avant tout rejeu confirmé).
 */
export async function facturerOrdreReparation(
  orId: string,
  entree: EntreeFacturationOrdreReparation,
  idempotencyKey: string,
): Promise<ReponseAvecAvertissements<ReponseFacturationOrdreReparation>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseFacturationOrdreReparation>>(
    `/ordres-reparation/${orId}/facturer`,
    { method: 'POST', body: JSON.stringify(entree), idempotencyKey },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /ordres-reparation/facturer.');
  }
  return reponse;
}
