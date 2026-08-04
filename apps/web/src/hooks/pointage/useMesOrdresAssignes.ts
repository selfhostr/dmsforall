import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { PageCurseur, ReponseOrdreReparation } from '@dfa/shared';

import { listerMesOrdresAssignes, type FiltresMesOrdresAssignes } from './mes-ordres-assignes.api';

const LIMITE = 50;

/** « Mes OR du jour » — les OR encore ouverts sur lesquels le technicien courant a une ligne
 *  assignée (ou peut pointer sans ligne précise, RM-87 `productif_or`). Pas de pagination par
 *  curseur ici : un technicien a rarement plus d'une poignée d'OR ouverts en parallèle, `LIMITE`
 *  sert de plafond de sécurité, pas une troncature attendue en usage normal.
 *
 *  Type de retour `ReponseOrdreReparation` (document complet, `lignes` incluses), PAS
 *  `OrdreReparationResume` : c'est ce que `ServiceOr.lister` renvoie réellement pour cet endpoint
 *  (voir le commentaire détaillé de `mes-ordres-assignes.api.ts`), et c'est ce dont a besoin
 *  `compterLignesAssigneesPointables` (`./lignes-assignees.ts`) pour que le compteur de la carte
 *  « Mes OR du jour » compte les lignes réellement assignées au technicien, pas le total de l'OR. */
export function useMesOrdresAssignes(
  technicienId: string | undefined,
): UseQueryResult<readonly ReponseOrdreReparation[]> {
  return useQuery({
    queryKey: ['pointages', 'mesOrdresAssignes', technicienId ?? ''] as const,
    queryFn: async () => {
      const filtres: FiltresMesOrdresAssignes = {
        technicienId: technicienId as string,
        statut: ['ouvert', 'en_cours'],
        tri: 'ouvertLe:desc',
      };
      const page: PageCurseur<ReponseOrdreReparation> = await listerMesOrdresAssignes(
        filtres,
        LIMITE,
      );
      return page.donnees;
    },
    enabled: Boolean(technicienId),
  });
}
