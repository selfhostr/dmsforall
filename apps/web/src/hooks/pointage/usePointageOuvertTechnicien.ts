import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponsePointage } from '@dfa/shared';

import { clesPointage } from './cles';
import { listerPointages } from './pointage.api';

/**
 * Le pointage `en_cours` du technicien courant, s'il y en a un — la question posée en
 * permanence par `EcranPointageTechnicien` : « suis-je en train de pointer, et sur quoi ? ».
 *
 * `GET /pointages?technicienId=&statut=en_cours&limite=1` plutôt qu'une route dédiée : RM-88/89
 * garantit qu'un technicien n'a JAMAIS plus d'un pointage `en_cours` à la fois (un nouveau départ
 * clôture automatiquement l'ancien) — `limite=1` est donc un plafond de sécurité, pas une troncature
 * qui perdrait un second pointage ouvert légitime.
 *
 * `data === null` (jamais `undefined` une fois la requête résolue) -> aucun pointage en cours.
 */
export function usePointageOuvertTechnicien(
  technicienId: string | undefined,
): UseQueryResult<ReponsePointage | null> {
  return useQuery({
    // Liste/état critique du poste : toujours frais, rechargé au retour sur l'onglet (le défaut du
    // QueryClient — 30 s, sans rechargement au focus — ne s'applique pas ici).
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryKey: clesPointage.ouvertTechnicien(technicienId ?? ''),
    queryFn: async () => {
      const page = await listerPointages(
        { technicienId, statut: ['en_cours'], tri: 'debutLe:desc' },
        { limite: 1 },
      );
      return page.donnees[0] ?? null;
    },
    enabled: Boolean(technicienId),
  });
}
