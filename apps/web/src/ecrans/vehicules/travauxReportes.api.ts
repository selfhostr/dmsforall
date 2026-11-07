import type {
  EntreeCreationTravailReporte,
  EntreeModificationTravailReporte,
  ReponseTravailReporte,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * Transport RM-73 — co-localisé ici plutôt que dans `hooks/vehicules/vehicules.api.ts` (même
 * convention que `EcranFicheClient.tsx::cheminOr` pour les routes) : `hooks/vehicules/**` est hors
 * du périmètre d'écriture de ce lot, `ecrans/vehicules/**` en fait partie. Aucun conflit de clé de
 * cache : `clesQuery.vehicules.travauxReportes(id)` (déjà gelé dans `api/cles.ts`) reste l'unique
 * source de vérité, ce module ne fait que l'alimenter.
 *
 * `GET .../travaux-reportes` est appelé SANS filtre `statut`/`urgence` — le panneau (voir
 * `PanneauTravauxReportes.tsx`) récupère la liste complète (ouvert/repris/abandonné) une seule
 * fois et filtre/onglettise côté client : la ressource est bornée par nature (quelques travaux par
 * véhicule), et `clesQuery.vehicules.travauxReportes` ne porte pas de filtres dans sa clé — une clé
 * par filtre romprait l'invalidation croisée déjà câblée ailleurs sur cette même clé.
 */
export async function listerTravauxReportesVehicule(
  vehiculeId: string,
): Promise<readonly ReponseTravailReporte[]> {
  const travaux = await requeteApi<readonly ReponseTravailReporte[]>(
    `/vehicules/${vehiculeId}/travaux-reportes`,
    {
      method: 'GET',
    },
  );
  return travaux ?? [];
}

/** `PATCH /vehicules/{vehiculeId}/travaux-reportes/{travailId}` — correction ou transition de
 *  statut (RM-73). Un seul endpoint pour les deux gestes, voir le contrôleur serveur. */
export async function modifierTravailReporteVehicule(
  vehiculeId: string,
  travailId: string,
  entree: EntreeModificationTravailReporte,
): Promise<ReponseTravailReporte> {
  const reponse = await requeteApi<ReponseTravailReporte>(
    `/vehicules/${vehiculeId}/travaux-reportes/${travailId}`,
    { method: 'PATCH', body: JSON.stringify(entree) },
  );
  if (!reponse) {
    throw new Error('Réponse de modification du travail reporté inattendue : corps vide.');
  }
  return reponse;
}

/** `POST /vehicules/{vehiculeId}/travaux-reportes` — noter un travail « à faire la prochaine fois ». */
export async function creerTravailReporteVehicule(
  vehiculeId: string,
  entree: EntreeCreationTravailReporte,
): Promise<ReponseTravailReporte> {
  const reponse = await requeteApi<ReponseTravailReporte>(
    `/vehicules/${vehiculeId}/travaux-reportes`,
    { method: 'POST', body: JSON.stringify(entree) },
  );
  if (!reponse) {
    throw new Error('Réponse de création du travail reporté inattendue : corps vide.');
  }
  return reponse;
}
