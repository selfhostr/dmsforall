import type { ReponseMarquesVehiculesCh, ReponseModelesVehiculesCh } from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Couche transport du référentiel véhicules suisse (autocomplétion marque/modèle, contrat gelé
 * `packages/shared/src/contrats/vehicules/referentiel-vehicules-ch.ts`) — même convention que
 * `hooks/vehicules/vehicules.api.ts` : types consommés depuis `@dfa/shared`, jamais redéfinis ici.
 *
 * `LIMITE_SUGGESTIONS` : liste compacte adaptée à une combobox de comptoir (bien en-deçà du
 * plafond serveur `LIMITE_MAX_REFERENTIEL_VEHICULES_CH` = 50) — au-delà d'une poignée de
 * suggestions, un garagiste a de toute façon fini de taper le nom avant d'avoir tout lu.
 */
const LIMITE_SUGGESTIONS = 8;

export async function rechercherMarquesVehicules(
  recherche: string,
  signal: AbortSignal | undefined,
): Promise<ReponseMarquesVehiculesCh> {
  const parametres = new URLSearchParams();
  if (recherche.trim() !== '') parametres.set('recherche', recherche.trim());
  parametres.set('limite', String(LIMITE_SUGGESTIONS));

  const reponse = await requeteApi<ReponseMarquesVehiculesCh>(
    `/referentiels/vehicules/marques?${parametres.toString()}`,
    { method: 'GET', signal },
  );
  return reponse ?? { marques: [] };
}

export async function rechercherModelesVehicules(
  marque: string,
  recherche: string,
  signal: AbortSignal | undefined,
): Promise<ReponseModelesVehiculesCh> {
  const parametres = new URLSearchParams({ marque: marque.trim() });
  if (recherche.trim() !== '') parametres.set('recherche', recherche.trim());
  parametres.set('limite', String(LIMITE_SUGGESTIONS));

  const reponse = await requeteApi<ReponseModelesVehiculesCh>(
    `/referentiels/vehicules/modeles?${parametres.toString()}`,
    { method: 'GET', signal },
  );
  return reponse ?? { modeles: [] };
}
