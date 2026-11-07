import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import type { ReponseEtatDemarrage } from '@dfa/shared';

import { requeteApi } from '@/api/client';

import { calculerEtapesDemarrage, demarrageComplet, type EtapeDemarrage } from './etapes-demarrage';

export interface EtatDemarrage {
  readonly etapes: readonly EtapeDemarrage[];
  /** L'appel n'a pas encore répondu : on affiche un squelette, pas un état faux. */
  readonly enChargement: boolean;
  readonly complet: boolean;
  readonly reessayer: () => void;
}

/**
 * État réel de la mise en route du garage : UN appel `GET /accueil/etat-demarrage` (jamais une
 * case cochée à la main). Rafraîchi au retour sur l'accueil et au retour de focus, pour refléter
 * un réglage fait entre-temps.
 */
export function useEtapesDemarrage(): EtatDemarrage {
  const requete = useQuery({
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryKey: ['accueil', 'etat-demarrage'],
    queryFn: async () => {
      const reponse = await requeteApi<ReponseEtatDemarrage>('/accueil/etat-demarrage', {
        method: 'GET',
      });
      if (!reponse) throw new Error('Réponse vide inattendue : GET /accueil/etat-demarrage.');
      return reponse;
    },
  });

  const etapes = useMemo(() => calculerEtapesDemarrage(requete.data), [requete.data]);

  return {
    etapes,
    enChargement: requete.isPending,
    complet: !requete.isPending && demarrageComplet(etapes),
    reessayer: () => {
      if (requete.isError) void requete.refetch();
    },
  };
}
