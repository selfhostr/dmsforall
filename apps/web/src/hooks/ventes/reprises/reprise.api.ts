import type {
  EntreeActionConfirmerReprise,
  EntreeActionNegocierReprise,
  EntreeActionRefuserReprise,
  EntreeCreationReprise,
  EntreeModificationReprise,
  ReponseAvecAvertissements,
  ReponseReprise,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Couche transport de la reprise (`RV-19` → `RV-28`) — même convention que
 * `hooks/pieces/articles.api.ts` : les types consommés sont ceux de `@dfa/shared`
 * (`packages/shared/src/contrats/ventes/reprise.ts`), jamais `api/types.gen.ts`.
 *
 * Sous-ressource SINGULIÈRE de `/dossiers-vente/{dossierVenteId}/reprise` — pas de `/reprises`
 * autonome (voir l'en-tête du contrat). Toutes les routes existent côté API
 * (`apps/api/src/ventes/reprise.controller.ts`), prouvées avant l'écriture de ce fichier.
 */

/** `GET /dossiers-vente/{id}/reprise` — 404 si aucune reprise n'existe encore sur ce dossier
 *  (RV-25, composante optionnelle) : l'appelant (`useReprise`) ne doit déclencher cette requête
 *  QUE si `dossier.reprise !== null` est déjà connu par ailleurs (même patron que le design,
 *  §8 : « requête secondaire non bloquante, déclenchée seulement si `dossier.reprise !== null` »)
 *  — ce module n'a donc jamais à distinguer un 404 attendu d'une vraie erreur. */
export async function recupererReprise(dossierVenteId: string): Promise<ReponseReprise> {
  const reprise = await requeteApi<ReponseReprise>(`/dossiers-vente/${dossierVenteId}/reprise`, {
    method: 'GET',
  });
  if (!reprise) {
    throw new Error('Réponse reprise inattendue : corps vide.');
  }
  return reprise;
}

/** `POST /dossiers-vente/{id}/reprise` — `Idempotency-Key` obligatoire (RV-25 : au plus une
 *  reprise par dossier, `409 VENTE_REPRISE_DEJA_EXISTANTE` sinon). */
export async function creerReprise(
  dossierVenteId: string,
  entree: EntreeCreationReprise,
  idempotencyKey: string,
): Promise<ReponseAvecAvertissements<ReponseReprise>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseReprise>>(
    `/dossiers-vente/${dossierVenteId}/reprise`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
      idempotencyKey,
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /dossiers-vente/reprise.');
  }
  return reponse;
}

/** `PATCH /dossiers-vente/{id}/reprise` — `If-Match` obligatoire (`W/"<version>"`, lu sur la
 *  dernière lecture). Refusé au-delà de `statut = estimee` (RV-27, contrôlé serveur). */
export async function modifierReprise(
  dossierVenteId: string,
  entree: EntreeModificationReprise,
  etag: string,
): Promise<ReponseAvecAvertissements<ReponseReprise>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseReprise>>(
    `/dossiers-vente/${dossierVenteId}/reprise`,
    {
      method: 'PATCH',
      body: JSON.stringify(entree),
      ifMatch: etag,
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : PATCH /dossiers-vente/reprise.');
  }
  return reponse;
}

/** `POST /dossiers-vente/{id}/reprise/negocier` — `{estimee,negociee} -> negociee`, rejouable
 *  (RV-06 : chaque appel est un événement audité, jamais un `PATCH` silencieux). */
export async function negocierReprise(
  dossierVenteId: string,
  entree: EntreeActionNegocierReprise,
): Promise<ReponseAvecAvertissements<ReponseReprise>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseReprise>>(
    `/dossiers-vente/${dossierVenteId}/reprise/negocier`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /dossiers-vente/reprise/negocier.');
  }
  return reponse;
}

/** `POST /dossiers-vente/{id}/reprise/confirmer` — `negociee -> confirmee`, correction
 *  exceptionnelle (NORMALEMENT un effet de bord de `POST /dossiers-vente/{id}/engager`, hors
 *  périmètre de ce module). Motif obligatoire. */
export async function confirmerReprise(
  dossierVenteId: string,
  entree: EntreeActionConfirmerReprise,
): Promise<ReponseAvecAvertissements<ReponseReprise>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseReprise>>(
    `/dossiers-vente/${dossierVenteId}/reprise/confirmer`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /dossiers-vente/reprise/confirmer.');
  }
  return reponse;
}

/** `POST /dossiers-vente/{id}/reprise/refuser` — `{estimee,negociee} -> refusee`, motif
 *  obligatoire (RV-25 : le client garde son véhicule, le reste du dossier continue). */
export async function refuserReprise(
  dossierVenteId: string,
  entree: EntreeActionRefuserReprise,
): Promise<ReponseAvecAvertissements<ReponseReprise>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseReprise>>(
    `/dossiers-vente/${dossierVenteId}/reprise/refuser`,
    {
      method: 'POST',
      body: JSON.stringify(entree),
    },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /dossiers-vente/reprise/refuser.');
  }
  return reponse;
}
