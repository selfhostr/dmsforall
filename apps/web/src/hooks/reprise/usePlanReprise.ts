import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import type { EntreeAjustementPlanReprise, ReponsePlanReprise } from '@dfa/shared';

import { useCleIdempotence } from '@/api/idempotence';

import { clesReprise } from './cles';
import { modifierPlan, recupererPlan, validerPlan } from './reprise.api';

/** `GET /reprise/dossiers/{id}/plan` — activée uniquement si `dossier.planId !== null`. Pas de
 *  sondage : le plan n'évolue plus une fois généré (`analyse_terminee -> plan_propose`), seule
 *  une action humaine (ajustement, validation) le fait bouger — et ces deux actions invalident
 *  déjà la clé elles-mêmes. */
export function usePlanReprise(
  dossierId: string | undefined,
  planDisponible: boolean,
): UseQueryResult<ReponsePlanReprise> {
  return useQuery({
    queryKey: clesReprise.plan(dossierId ?? ''),
    queryFn: () => recupererPlan(dossierId as string),
    enabled: dossierId !== undefined && planDisponible,
  });
}

/** `PATCH /reprise/dossiers/{id}/plan` — LE seul levier : inclure/exclure des domaines en bloc. */
export function useModifierPlanReprise(dossierId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ajustements: readonly EntreeAjustementPlanReprise[]) =>
      modifierPlan(dossierId as string, { ajustements: [...ajustements] }),
    onSuccess: (plan) => {
      if (dossierId) {
        queryClient.setQueryData(clesReprise.plan(dossierId), plan);
      }
    },
  });
}

/** `POST /reprise/dossiers/{id}/plan/valider` — LA validation humaine unique. Idempotency-Key
 *  générée au montage de l'écran de validation (même doctrine que tout formulaire du produit,
 *  `useCleIdempotence`) : un double-clic sur « Lancer l'import » ne doit jamais démarrer deux
 *  imports. Invalide le dossier (transition `plan_propose -> plan_valide -> import_en_cours`) et
 *  le plan (statut `valide`). */
export function useValiderPlanReprise(dossierId: string | undefined) {
  const queryClient = useQueryClient();
  const { cle } = useCleIdempotence();
  return useMutation({
    mutationFn: () => validerPlan(dossierId as string, cle),
    onSuccess: (plan) => {
      if (dossierId) {
        queryClient.setQueryData(clesReprise.plan(dossierId), plan);
      }
      void queryClient.invalidateQueries({ queryKey: clesReprise.dossiers.liste() });
    },
  });
}
