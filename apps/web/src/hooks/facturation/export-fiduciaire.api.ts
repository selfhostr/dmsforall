import type { EntreeLancerExport } from '@dfa/shared';

import type { components } from '@/api/types.gen';
import { requeteApi } from '@/api/client';

/** Réponse de `POST /exports-fiduciaires` — type GÉNÉRÉ depuis l'OpenAPI (le DTO de réponse vit
 *  côté API, pas dans `@dfa/shared`). */
export type ReponseExportFiduciaire = components['schemas']['ExportComptableAvecAvertissementsDto'];
export type LotExportFiduciaire = components['schemas']['LotExportProduitDto'];

/**
 * `POST /exports-fiduciaires` — `Idempotency-Key` OBLIGATOIRE. Réponse `201` (au moins un
 * document ou paiement exporté) ou `200` avec `donnees.lots: []` (rien à exporter) : les deux
 * passent par ici, c'est à l'appelant de lire `lots`.
 */
export async function lancerExportFiduciaire(
  entree: EntreeLancerExport,
  idempotencyKey: string,
): Promise<ReponseExportFiduciaire> {
  const reponse = await requeteApi<ReponseExportFiduciaire>('/exports-fiduciaires', {
    method: 'POST',
    body: JSON.stringify(entree),
    idempotencyKey,
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /exports-fiduciaires.');
  }
  return reponse;
}
