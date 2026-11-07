import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { OrdreReparationResumeListe } from '@dfa/shared';

import { compterLignesAssigneesPointables } from './lignes-assignees';
import {
  listerMesOrdresAssignes,
  listerMesOrdresAssignesComplets,
  type FiltresMesOrdresAssignes,
} from './mes-ordres-assignes.api';

const LIMITE = 50;

/** Ce que « Mes OR du jour » affiche d'un OR : identité, échéance et nombre de lignes assignées. */
export type OrDuJour = Pick<
  OrdreReparationResumeListe,
  'id' | 'numero' | 'siteId' | 'restitutionPromiseLe' | 'vehicule' | 'client'
> & {
  /** Le serveur calcule le retard ; absent = pas dit en retard. */
  readonly enRetard?: boolean;
  /** Lignes de l'OR assignées au technicien, hors annulées et refusées. */
  readonly lignesAssignees: number;
};

export interface OptionsMesOrdresAssignes {
  /**
   * `serveur` (défaut) : `forme=resume`, le serveur compte les lignes assignées au compte de
   * SESSION (`nombreLignesAssignees`) — le bon choix quand le technicien est l'utilisateur connecté.
   * `document` : document complet, compté ici pour le technicien identifié par PIN (borne : le
   * compte de session n'est pas un technicien, le compteur serveur vaudrait 0).
   */
  readonly comptage?: 'serveur' | 'document';
}

/** « Mes OR du jour » — les OR encore ouverts sur lesquels le technicien courant a une ligne
 *  assignée (ou peut pointer sans ligne précise, RM-87 `productif_or`). Pas de pagination par
 *  curseur ici : un technicien a rarement plus d'une poignée d'OR ouverts en parallèle, `LIMITE`
 *  sert de plafond de sécurité, pas une troncature attendue en usage normal. */
export function useMesOrdresAssignes(
  technicienId: string | undefined,
  options: OptionsMesOrdresAssignes = {},
): UseQueryResult<readonly OrDuJour[]> {
  const comptage = options.comptage ?? 'serveur';
  return useQuery({
    // Liste/état critique du poste : toujours frais, rechargé au retour sur l'onglet (le défaut du
    // QueryClient — 30 s, sans rechargement au focus — ne s'applique pas ici).
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryKey: ['pointages', 'mesOrdresAssignes', comptage, technicienId ?? ''] as const,
    queryFn: async (): Promise<readonly OrDuJour[]> => {
      const filtres: FiltresMesOrdresAssignes = {
        technicienId: technicienId as string,
        statut: ['ouvert', 'en_cours'],
        tri: 'ouvertLe:desc',
      };
      if (comptage === 'document') {
        const page = await listerMesOrdresAssignesComplets(filtres, LIMITE);
        return page.donnees.map((or) => ({
          ...or,
          lignesAssignees: compterLignesAssigneesPointables(or, technicienId as string),
        }));
      }
      const page = await listerMesOrdresAssignes(filtres, LIMITE);
      return page.donnees.map((or) => ({ ...or, lignesAssignees: or.nombreLignesAssignees }));
    },
    enabled: Boolean(technicienId),
  });
}
