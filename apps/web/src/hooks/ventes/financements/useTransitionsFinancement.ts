import { useMutation, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeActionConfirmerFinancement,
  EntreeActionRefuserFinancement,
  EntreeCreationFinancement,
  ReponseAvecAvertissements,
  ReponseFinancement,
} from '@dfa/shared';

import { confirmerFinancement, creerFinancement, refuserFinancement } from './financement.api';

interface VariablesCreationFinancement {
  readonly entree: EntreeCreationFinancement;
  readonly idempotencyKey: string;
}

/**
 * `POST /dossiers-vente/{id}/financements` — AUCUNE écriture de cache ici (voir l'en-tête de
 * `financement.api.ts` : pas de `GET` dédié, donc pas de clé TanStack Query à ce nom). La
 * collection `financements`/`financement` vit UNIQUEMENT dans `ReponseDossierVente` — c'est à
 * l'écran intégrateur (fiche dossier) d'invalider/recharger sa propre requête dossier dans le
 * `onSuccess` qu'il passe à `mutate(...)` (même composition que `EcranFicheArticle` :
 * `mutation.mutate(entree, { onSuccess: () => refetchDossier() })`).
 */
export function useCreerFinancement(
  dossierVenteId: string,
): UseMutationResult<
  ReponseAvecAvertissements<ReponseFinancement>,
  unknown,
  VariablesCreationFinancement
> {
  return useMutation({
    mutationFn: ({ entree, idempotencyKey }: VariablesCreationFinancement) =>
      creerFinancement(dossierVenteId, entree, idempotencyKey),
  });
}

interface VariablesActionFinancement<TEntree> {
  readonly financementId: string;
  readonly entree: TEntree;
}

/** `POST /dossiers-vente/{id}/financements/{financementId}/confirmer` — `en_attente -> confirme`. */
export function useConfirmerFinancement(
  dossierVenteId: string,
): UseMutationResult<
  ReponseAvecAvertissements<ReponseFinancement>,
  unknown,
  VariablesActionFinancement<EntreeActionConfirmerFinancement>
> {
  return useMutation({
    mutationFn: ({ financementId, entree }) =>
      confirmerFinancement(dossierVenteId, financementId, entree),
  });
}

/** `POST /dossiers-vente/{id}/financements/{financementId}/refuser` — TERMINAL (CV-03), motif
 *  obligatoire. */
export function useRefuserFinancement(
  dossierVenteId: string,
): UseMutationResult<
  ReponseAvecAvertissements<ReponseFinancement>,
  unknown,
  VariablesActionFinancement<EntreeActionRefuserFinancement>
> {
  return useMutation({
    mutationFn: ({ financementId, entree }) =>
      refuserFinancement(dossierVenteId, financementId, entree),
  });
}
