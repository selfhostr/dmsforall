import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import type {
  EntreeActionAbsenceRendezVous,
  EntreeActionAnnulerRendezVous,
  ReponseRendezVous,
} from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { absenceRendezVous, annulerRendezVous } from './rendez-vous.api';

/**
 * Une transition par action nommée (§7 métier) — jamais un `PATCH` générique, même doctrine que
 * `hooks/atelier/useTransitionsOrdreReparation.ts` (copié, pas réinventé). Chaque transition
 * renvoie le DOCUMENT COMPLET : posé directement dans le cache (`rdv.detail`), la période et la
 * capacité affichées invalidées par PRÉFIXE (le statut change, le calcul de capacité aussi).
 */
export function useActionRendezVous<TEntree extends object>(
  rdvId: string,
  action: (rdvId: string, entree: TEntree) => Promise<ReponseRendezVous>,
): UseMutationResult<ReponseRendezVous, unknown, TEntree> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entree: TEntree) => action(rdvId, entree),
    onSuccess: (rendezVous) => {
      queryClient.setQueryData(clesQuery.rdv.detail(rdvId), rendezVous);
      void queryClient.invalidateQueries({ queryKey: ['rdv', 'plage'] });
      void queryClient.invalidateQueries({ queryKey: ['rdv', 'resume-sites'] });
      void queryClient.invalidateQueries({ queryKey: ['rdv', 'charge'] });
    },
  });
}

/** RV-24 : constat manuel, sans motif. */
export function useAbsenceRendezVous(rdvId: string) {
  return useActionRendezVous<EntreeActionAbsenceRendezVous>(rdvId, absenceRendezVous);
}

/** Motif obligatoire, jamais silencieuse. */
export function useAnnulerRendezVous(rdvId: string) {
  return useActionRendezVous<EntreeActionAnnulerRendezVous>(rdvId, annulerRendezVous);
}
