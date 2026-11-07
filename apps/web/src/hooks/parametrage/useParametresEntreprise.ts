import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { clesParametrage } from './cles';
import { recupererParametresEntreprise, type ReponseParametresEntreprise } from './entreprise.api';

/** Lu par l'écran Facturation et par la liste « Démarrer votre garage » (n° TVA saisi ou non). */
export function useParametresEntreprise(): UseQueryResult<ReponseParametresEntreprise> {
  return useQuery({
    queryKey: clesParametrage.entreprise(),
    queryFn: recupererParametresEntreprise,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}
