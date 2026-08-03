import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { OrdreReparationResume, PageCurseur } from '@dfa/shared';

import { listerMesOrdresAssignes, type FiltresMesOrdresAssignes } from './mes-ordres-assignes.api';

const LIMITE = 50;

/** « Mes OR du jour » — les OR encore ouverts sur lesquels le technicien courant a une ligne
 *  assignée (ou peut pointer sans ligne précise, RM-87 `productif_or`). Pas de pagination par
 *  curseur ici : un technicien a rarement plus d'une poignée d'OR ouverts en parallèle, `LIMITE`
 *  sert de plafond de sécurité, pas une troncature attendue en usage normal. */
export function useMesOrdresAssignes(technicienId: string | undefined): UseQueryResult<readonly OrdreReparationResume[]> {
  return useQuery({
    queryKey: ['pointages', 'mesOrdresAssignes', technicienId ?? ''] as const,
    queryFn: async () => {
      const filtres: FiltresMesOrdresAssignes = {
        technicienId: technicienId as string,
        statut: ['ouvert', 'en_cours'],
        tri: 'ouvertLe:desc',
      };
      const page: PageCurseur<OrdreReparationResume> = await listerMesOrdresAssignes(filtres, LIMITE);
      return page.donnees;
    },
    enabled: Boolean(technicienId),
  });
}
