import type {
  EntreeLiberationReservation,
  FiltresReservations,
  PageCurseur,
  ReponseAvecAvertissements,
  ReponseReservationPiece,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/** Couche transport des réservations (RP-19 → RP-25) — même remarque d'écart que
 *  `articles.api.ts`. Aucune création ici : une réservation naît toujours comme effet de bord de
 *  `POST /ordres-reparation/{orId}/lignes` (module atelier, hors périmètre). */

export interface PageReservations {
  readonly limite: number;
  readonly curseur?: string;
}

function construireParametresReservations(filtres: FiltresReservations, page: PageReservations): string {
  const parametres = new URLSearchParams();
  if (filtres.articleId) parametres.set('articleId', filtres.articleId);
  if (filtres.siteId) parametres.set('siteId', filtres.siteId);
  if (filtres.ordreReparationId) parametres.set('ordreReparationId', filtres.ordreReparationId);
  for (const valeur of filtres.statut ?? []) parametres.append('statut', valeur);
  parametres.set('tri', filtres.tri);
  parametres.set('limite', String(page.limite));
  if (page.curseur) parametres.set('curseur', page.curseur);
  return parametres.toString();
}

/** `GET /reservations` — vue transverse : qu'est-ce qui est réservé, pour qui, depuis quand. */
export async function listerReservations(
  filtres: FiltresReservations,
  page: PageReservations,
): Promise<PageCurseur<ReponseReservationPiece>> {
  const reponse = await requeteApi<PageCurseur<ReponseReservationPiece>>(
    `/reservations?${construireParametresReservations(filtres, page)}`,
    { method: 'GET' },
  );
  return reponse ?? { donnees: [], curseurSuivant: null, limite: page.limite };
}

/** `POST /reservations/{id}/satisfaire` — le magasinier remet PHYSIQUEMENT la pièce (RP-21).
 *  Pas d'`Idempotency-Key` : transition gardée par l'état de départ (`active`), pas une
 *  création. */
export async function satisfaireReservation(id: string): Promise<ReponseReservationPiece> {
  const reponse = await requeteApi<ReponseReservationPiece>(`/reservations/${id}/satisfaire`, { method: 'POST' });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /reservations/satisfaire.');
  }
  return reponse;
}

/** `POST /reservations/{id}/liberer` — geste EXPLICITE du magasinier ou du chef d'atelier
 *  (RP-23, 3e cas), motif obligatoire. */
export async function libererReservation(
  id: string,
  entree: EntreeLiberationReservation,
): Promise<ReponseAvecAvertissements<ReponseReservationPiece>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseReservationPiece>>(`/reservations/${id}/liberer`, {
    method: 'POST',
    body: JSON.stringify(entree),
  });
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /reservations/liberer.');
  }
  return reponse;
}
