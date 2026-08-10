import type {
  EntreeChangementDetenteur,
  ReponseAvecAvertissements,
  ReponseVehicule,
} from '@dfa/shared';

import { requeteApi } from '@/api/client';

/**
 * `POST /vehicules/{id}/changer-detenteur` (RM-20/21, CT-47) — le geste normal pour rattacher un
 * véhicule à un client ET pour changer de détenteur (occasion revendue) : un seul appel, atomique
 * côté serveur (clôture de la détention en cours s'il y en a une, ouverture de la nouvelle). Voir
 * `DialogueRattacherClient.tsx` (même répertoire) pour l'écran qui l'appelle.
 *
 * Fichier co-localisé dans `ecrans/vehicules/` plutôt que `hooks/vehicules/` (hors périmètre
 * d'écriture de cet agent) — même convention que `travauxReportes.api.ts` /
 * `useModifierTravailReporte.ts` déjà présents dans ce répertoire.
 */
export async function changerDetenteurVehicule(
  vehiculeId: string,
  entree: EntreeChangementDetenteur,
): Promise<ReponseAvecAvertissements<ReponseVehicule>> {
  const reponse = await requeteApi<ReponseAvecAvertissements<ReponseVehicule>>(
    `/vehicules/${vehiculeId}/changer-detenteur`,
    { method: 'POST', body: JSON.stringify(entree) },
  );
  if (!reponse) {
    throw new Error('Réponse vide inattendue : POST /vehicules/{id}/changer-detenteur.');
  }
  return reponse;
}
