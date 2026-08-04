import { requeteApi } from '@/api/client';
import type { ReponseBlocCreancier, EntreeModificationBlocCreancier } from '@dfa/shared';

/**
 * Couche transport du bloc créancier — `GET|PATCH /parametres-facturation/creancier`
 * (`apps/api/src/parametrage/bloc-creancier/`).
 *
 * Types issus du contrat partagé `packages/shared/src/contrats/facturation/creancier.ts`, source
 * de vérité UNIQUE de cette forme côté API et côté web — voir ce fichier pour la sémantique
 * « singleton par tenant, ligne absente = paramétrage vide, jamais 404 » et la distinction
 * `iban`/`qrIban`. `BlocCreancier` est un simple alias local de `ReponseBlocCreancier` : conservé
 * pour que les imports existants (`useBlocCreancier.ts`, `useModifierBlocCreancier.ts`,
 * `ecrans/parametrage/`) n'aient pas à changer de nom.
 */
export type BlocCreancier = ReponseBlocCreancier;
export type { EntreeModificationBlocCreancier };

/** `GET /parametres-facturation/creancier` — jamais un 404, voir `BlocCreancier`. */
export async function recupererBlocCreancier(): Promise<BlocCreancier> {
  const bloc = await requeteApi<BlocCreancier>('/parametres-facturation/creancier', {
    method: 'GET',
  });
  if (!bloc) {
    throw new Error('Réponse vide inattendue : GET /parametres-facturation/creancier.');
  }
  return bloc;
}

/** `PATCH /parametres-facturation/creancier` — pas d'`If-Match` : le contrôleur ne lit aucun
 *  en-tête de concurrence optimiste sur cette route (upsert, pas de ligne préexistante requise).
 *  Pas d'`Idempotency-Key` non plus : ce n'est pas une création qui consomme une ressource rare
 *  (numéro, etc.), juste la mise à jour d'un singleton de paramétrage. */
export async function modifierBlocCreancier(
  entree: EntreeModificationBlocCreancier,
): Promise<BlocCreancier> {
  const bloc = await requeteApi<BlocCreancier>('/parametres-facturation/creancier', {
    method: 'PATCH',
    body: JSON.stringify(entree),
  });
  if (!bloc) {
    throw new Error('Réponse vide inattendue : PATCH /parametres-facturation/creancier.');
  }
  return bloc;
}
