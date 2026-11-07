import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import type {
  ApercuExport,
  CibleExport,
  EntreeApercuExport,
  EntreeMettreAJourMapping,
  EtatMappingExport,
  ExportHistorique,
} from '@dfa/shared';

import { useDoitReessayer, useListeCurseur, type ListeCurseur } from '@/hooks/pagination-curseur';

import {
  clesExportFiduciaire,
  enregistrerMappingExport,
  lireApercuExport,
  lireMappingExport,
  listerExports,
  telechargerFichierConserve,
} from './export-fiduciaire.api';

/** Aperçu de la période. `undefined` : période pas encore valide, aucune requête. Toujours frais :
 *  un export, une émission ou un règlement ailleurs change la réponse. */
export function useApercuExport(
  entree: EntreeApercuExport | undefined,
): UseQueryResult<ApercuExport> {
  const reessayer = useDoitReessayer();
  return useQuery({
    queryKey: clesExportFiduciaire.apercu(
      entree ?? { cible: 'winbiz', periodeDu: '', periodeAu: '' },
    ),
    queryFn: () => {
      if (!entree) throw new Error('Aperçu demandé sans période.');
      return lireApercuExport(entree);
    },
    enabled: entree !== undefined,
    staleTime: 0,
    retry: reessayer,
  });
}

export function useHistoriqueExports(actif = true): ListeCurseur<ExportHistorique> {
  const reessayer = useDoitReessayer();
  return useListeCurseur({
    cle: clesExportFiduciaire.historique,
    charger: listerExports,
    actif,
    reessayer,
    fraicheur: 'toujours-frais',
  });
}

export function useMappingExport(
  cible: CibleExport,
  actif: boolean,
): UseQueryResult<EtatMappingExport> {
  const reessayer = useDoitReessayer();
  return useQuery({
    queryKey: clesExportFiduciaire.mapping(cible),
    queryFn: () => lireMappingExport(cible),
    enabled: actif,
    staleTime: 0,
    retry: reessayer,
  });
}

/** Enregistre les comptes ; l'aperçu (prérequis) et l'état du mapping sont périmés ensuite. */
export function useEnregistrerMapping(): UseMutationResult<
  EtatMappingExport,
  unknown,
  EntreeMettreAJourMapping
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: enregistrerMappingExport,
    onSuccess: (etat, entree) => {
      queryClient.setQueryData(clesExportFiduciaire.mapping(entree.cible), etat);
      void queryClient.invalidateQueries({ queryKey: [...clesExportFiduciaire.tout, 'apercu'] });
    },
  });
}

/** Fichier d'un lot déjà généré (octets), pour « Télécharger à nouveau ». */
export function useTelechargerFichierConserve(): UseMutationResult<Blob, unknown, string> {
  return useMutation({ mutationFn: telechargerFichierConserve });
}
