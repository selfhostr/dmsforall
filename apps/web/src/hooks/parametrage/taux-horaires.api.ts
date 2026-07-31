import type { z } from 'zod';

import {
  schemaCreationTauxHoraire,
  schemaModificationTauxHoraire,
  type EntreeCreationTauxHoraire,
  type PageCurseur,
  type ReponseTauxHoraire,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Couche transport des taux horaires — `GET|POST /referentiels/taux-horaires` · `PATCH /{id}`
 * (`apps/api/src/parametrage/referentiels/taux-horaires/`, RM-65 : périodes datées, jamais deux
 * périodes valides du même `code` ne se chevauchent pour un tenant).
 *
 * `EntreeModificationTauxHoraire` n'est pas exporté nommément par `@dfa/shared` (seul le schéma
 * `schemaModificationTauxHoraire` l'est) — dérivé ici via `z.infer`, jamais réécrit à la main.
 */
export type { ReponseTauxHoraire, EntreeCreationTauxHoraire };
export type EntreeModificationTauxHoraire = z.infer<typeof schemaModificationTauxHoraire>;

const LIMITE_PAR_PAGE = 100;

/** `GET /referentiels/taux-horaires` — pagination par curseur. Catalogue court (quelques dizaines
 *  d'entrées typiquement) : `limite` haute pour limiter le nombre d'allers-retours au premier
 *  chargement, sans pour autant abandonner la pagination par curseur (contrat, jamais de page
 *  numérotée). */
export async function listerTauxHoraires(curseur: string | null): Promise<PageCurseur<ReponseTauxHoraire>> {
  const params = new URLSearchParams({ limite: String(LIMITE_PAR_PAGE) });
  if (curseur) params.set('curseur', curseur);
  const page = await requeteApi<PageCurseur<ReponseTauxHoraire>>(`/referentiels/taux-horaires?${params.toString()}`, {
    method: 'GET',
  });
  if (!page) throw new Error('Réponse vide inattendue : GET /referentiels/taux-horaires.');
  return page;
}

/** `POST /referentiels/taux-horaires` — validé côté client par le MÊME schéma zod que le serveur
 *  (`schemaCreationTauxHoraire`, `@dfa/shared`) avant envoi. */
export async function creerTauxHoraire(entree: EntreeCreationTauxHoraire): Promise<ReponseTauxHoraire> {
  const corps = schemaCreationTauxHoraire.parse(entree);
  const reponse = await requeteApi<ReponseTauxHoraire>('/referentiels/taux-horaires', {
    method: 'POST',
    body: JSON.stringify(corps),
  });
  if (!reponse) throw new Error('Réponse vide inattendue : POST /referentiels/taux-horaires.');
  return reponse;
}

/** `PATCH /referentiels/taux-horaires/{id}` — jamais `code` (immuable, voir le contrôleur). */
export async function modifierTauxHoraire(id: string, entree: EntreeModificationTauxHoraire): Promise<ReponseTauxHoraire> {
  const corps = schemaModificationTauxHoraire.parse(entree);
  const reponse = await requeteApi<ReponseTauxHoraire>(`/referentiels/taux-horaires/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(corps),
  });
  if (!reponse) throw new Error(`Réponse vide inattendue : PATCH /referentiels/taux-horaires/${id}.`);
  return reponse;
}
