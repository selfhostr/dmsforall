import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseAnalyseReprise } from '@dfa/shared';

import { clesReprise } from './cles';
import { lancerAnalyse, recupererAnalyse } from './reprise.api';

/** `false` = sondage arrêté (analyse absente, ou déjà `terminee`/`echouee`). Actif uniquement
 *  tant que l'analyse est réellement `en_cours` — le seul statut transitoire du contrat
 *  (`STATUTS_ANALYSE_REPRISE`). */
export function calculerIntervalleSondageAnalyse(
  analyse: ReponseAnalyseReprise | undefined,
): number | false {
  return analyse?.statut === 'en_cours' ? 5_000 : false;
}

/**
 * `GET /reprise/dossiers/{id}/analyse` — activée uniquement si `dossier.analyseId !== null`
 * (même doctrine que `hooks/ventes/reprises/useReprise.ts` : ne jamais interroger une
 * sous-ressource qui n'existe pas encore, un 404 attendu n'apporte rien).
 */
export function useAnalyseReprise(
  dossierId: string | undefined,
  analyseDisponible: boolean,
): UseQueryResult<ReponseAnalyseReprise> {
  return useQuery({
    queryKey: clesReprise.analyse(dossierId ?? ''),
    queryFn: () => recupererAnalyse(dossierId as string),
    enabled: dossierId !== undefined && analyseDisponible,
    refetchInterval: (requete) => calculerIntervalleSondageAnalyse(requete.state.data),
  });
}

/** `POST /reprise/dossiers/{id}/analyses` — lance ou RELANCE l'analyse, jamais de redépôt de
 *  l'archive (`analyse_echouee -> analyse_en_cours`). Invalide la liste des dossiers ET l'analyse
 *  courante : la relance change le statut du dossier autant que celui de l'analyse. */
export function useLancerAnalyseReprise(dossierId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => lancerAnalyse(dossierId as string),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: clesReprise.dossiers.liste() });
      if (dossierId) {
        void queryClient.invalidateQueries({ queryKey: clesReprise.analyse(dossierId) });
      }
    },
  });
}
