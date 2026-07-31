import type { z } from 'zod';

import {
  schemaCreationPrestation,
  schemaModificationPrestation,
  type EntreeCreationPrestation,
  type PageCurseur,
  type ReponsePrestation,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Couche transport du catalogue de prestations — `GET|POST /referentiels/prestations` ·
 * `PATCH /{id}` (`apps/api/src/parametrage/referentiels/prestations/`). Prix HISTORISÉS : un
 * changement de `prixCentimes` ouvre une nouvelle période de prix côté serveur, jamais une
 * réécriture — voir `ReponsePrestation.prixCentimes`, valide AUJOURD'HUI uniquement.
 *
 * `EntreeModificationPrestation` n'est pas exporté nommément par `@dfa/shared` — dérivé via
 * `z.infer`, même geste que `taux-horaires.api.ts`.
 */
export type { ReponsePrestation, EntreeCreationPrestation };
export type EntreeModificationPrestation = z.infer<typeof schemaModificationPrestation>;

const LIMITE_PAR_PAGE = 100;

/** `GET /referentiels/prestations` — pagination par curseur. */
export async function listerPrestations(curseur: string | null): Promise<PageCurseur<ReponsePrestation>> {
  const params = new URLSearchParams({ limite: String(LIMITE_PAR_PAGE) });
  if (curseur) params.set('curseur', curseur);
  const page = await requeteApi<PageCurseur<ReponsePrestation>>(`/referentiels/prestations?${params.toString()}`, {
    method: 'GET',
  });
  if (!page) throw new Error('Réponse vide inattendue : GET /referentiels/prestations.');
  return page;
}

/** `POST /referentiels/prestations` — validé côté client par `schemaCreationPrestation`. */
export async function creerPrestation(entree: EntreeCreationPrestation): Promise<ReponsePrestation> {
  const corps = schemaCreationPrestation.parse(entree);
  const reponse = await requeteApi<ReponsePrestation>('/referentiels/prestations', {
    method: 'POST',
    body: JSON.stringify(corps),
  });
  if (!reponse) throw new Error('Réponse vide inattendue : POST /referentiels/prestations.');
  return reponse;
}

/** `PATCH /referentiels/prestations/{id}` — jamais `code` (immuable). */
export async function modifierPrestation(id: string, entree: EntreeModificationPrestation): Promise<ReponsePrestation> {
  const corps = schemaModificationPrestation.parse(entree);
  const reponse = await requeteApi<ReponsePrestation>(`/referentiels/prestations/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(corps),
  });
  if (!reponse) throw new Error(`Réponse vide inattendue : PATCH /referentiels/prestations/${id}.`);
  return reponse;
}
