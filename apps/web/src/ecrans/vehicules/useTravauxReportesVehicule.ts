import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseTravailReporte } from '@dfa/shared';

import { clesQuery } from '@/api/cles';

import { listerTravauxReportesVehicule } from './travauxReportes.api';

/** `GET /vehicules/{id}/travaux-reportes` (RM-73) — liste COMPLÈTE, non bornée (à la différence de
 *  la section `travauxReportes` de `contexte-atelier`, plafonnée à `MAX_TRAVAUX_REPORTES_CONTEXTE`
 *  et limitée aux `ouvert`) : c'est la vue de gestion, `PanneauTravauxReportes` filtre par onglet
 *  côté client. */
export function useTravauxReportesVehicule(vehiculeId: string | undefined): UseQueryResult<readonly ReponseTravailReporte[]> {
  return useQuery({
    queryKey: clesQuery.vehicules.travauxReportes(vehiculeId ?? ''),
    queryFn: () => listerTravauxReportesVehicule(vehiculeId as string),
    enabled: Boolean(vehiculeId),
  });
}
