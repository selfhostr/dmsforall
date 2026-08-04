import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeActionAbandonnerDossierVente,
  EntreeActionAnnulerDossierVente,
  EntreeActionCloturerDossierVente,
  EntreeActionEngager,
  EntreeActionLivrer,
  EntreeActionMarquerPretALivrer,
  EntreeActionPreparer,
  ReponseAvecAvertissements,
  ReponseDossierVente,
} from '@dfa/shared';

import { clesVentesDossiers } from './cles';
import {
  abandonnerDossierVente,
  annulerDossierVente,
  cloturerDossierVente,
  engagerDossierVente,
  livrerDossierVente,
  marquerDossierPretALivrer,
  preparerDossierVente,
} from './dossiers-vente.api';

/**
 * Une mutation par action de transition du dossier de vente (§6.2) — même patron que
 * `useTransitionsOrdreReparation`/`useTransitionsArticle` : chaque action renvoie le dossier
 * COMPLET, posé directement dans le cache (jamais de relecture), et invalide la liste par PRÉFIXE.
 *
 * `annuler`/`abandonner` ont un effet de bord documenté côté serveur (véhicule réservé qui
 * redevient `disponible`, CV-01) — ce hook ne le rejoue pas côté client, il se contente de rafraîchir
 * le dossier ; la fiche véhicule/le parc en stock (hors périmètre) se rafraîchira à sa prochaine
 * lecture.
 */
function useActionDossierVente<TEntree>(
  dossierVenteId: string,
  action: (id: string, entree: TEntree) => Promise<ReponseAvecAvertissements<ReponseDossierVente>>,
): UseMutationResult<ReponseAvecAvertissements<ReponseDossierVente>, unknown, TEntree> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entree: TEntree) => action(dossierVenteId, entree),
    onSuccess: (reponse) => {
      queryClient.setQueryData(clesVentesDossiers.detail(dossierVenteId), reponse.donnees);
      void queryClient.invalidateQueries({ queryKey: ['ventes', 'dossiers', 'liste'] });
    },
  });
}

/** `POST /dossiers-vente/{id}/engager` — `prospection -> engage` (RV-32). */
export function useEngagerDossierVente(dossierVenteId: string) {
  return useActionDossierVente<EntreeActionEngager>(dossierVenteId, engagerDossierVente);
}

/** `POST /dossiers-vente/{id}/preparer` — `engage -> en_preparation`. */
export function usePreparerDossierVente(dossierVenteId: string) {
  return useActionDossierVente<EntreeActionPreparer>(dossierVenteId, preparerDossierVente);
}

/** `POST /dossiers-vente/{id}/marquer-pret-a-livrer` — `en_preparation -> pret_a_livrer` (RV-37). */
export function useMarquerDossierPretALivrer(dossierVenteId: string) {
  return useActionDossierVente<EntreeActionMarquerPretALivrer>(
    dossierVenteId,
    marquerDossierPretALivrer,
  );
}

/** `POST /dossiers-vente/{id}/livrer` — `pret_a_livrer -> livre` (RV-52/RV-53). */
export function useLivrerDossierVente(dossierVenteId: string) {
  return useActionDossierVente<EntreeActionLivrer>(dossierVenteId, livrerDossierVente);
}

/** `POST /dossiers-vente/{id}/cloturer` — `livre -> clos`. */
export function useCloturerDossierVente(dossierVenteId: string) {
  return useActionDossierVente<EntreeActionCloturerDossierVente>(
    dossierVenteId,
    cloturerDossierVente,
  );
}

/** `POST /dossiers-vente/{id}/annuler` — motif obligatoire, avant `pret_a_livrer` uniquement (RV-38). */
export function useAnnulerDossierVente(dossierVenteId: string) {
  return useActionDossierVente<EntreeActionAnnulerDossierVente>(
    dossierVenteId,
    annulerDossierVente,
  );
}

/** `POST /dossiers-vente/{id}/abandonner` — même garde que `annuler`, sémantique distincte. */
export function useAbandonnerDossierVente(dossierVenteId: string) {
  return useActionDossierVente<EntreeActionAbandonnerDossierVente>(
    dossierVenteId,
    abandonnerDossierVente,
  );
}
