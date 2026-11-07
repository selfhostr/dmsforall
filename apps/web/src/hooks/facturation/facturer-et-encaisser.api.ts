import type {
  EntreeFacturerEtEncaisserOr,
  ReponseAvecAvertissements,
  ReponseFacturerEtEncaisserOr,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/** `POST /ordres-reparation/{orId}/facturer-et-encaisser` — facture du groupe client créée, émise
 *  et (si `paiement`) encaissée en un appel. `Idempotency-Key` obligatoire. */
export async function facturerEtEncaisserOr(
  orId: string,
  entree: EntreeFacturerEtEncaisserOr,
  idempotencyKey: string,
): Promise<ReponseAvecAvertissements<ReponseFacturerEtEncaisserOr>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseFacturerEtEncaisserOr>>(
    `/ordres-reparation/${orId}/facturer-et-encaisser`,
    { method: 'POST', body: JSON.stringify(entree), idempotencyKey },
  );
  if (!reponse)
    throw new Error('Réponse vide inattendue : POST /ordres-reparation/facturer-et-encaisser.');
  return reponse;
}
