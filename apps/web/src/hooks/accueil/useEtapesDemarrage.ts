import { useMemo } from 'react';

import { useBlocCreancier } from '@/hooks/parametrage/useBlocCreancier';
import { useListeBornes } from '@/hooks/parametrage/useBornes';
import { useListeTauxHoraires } from '@/hooks/parametrage/useListeTauxHoraires';
import { useListeUtilisateurs } from '@/hooks/parametrage/useListeUtilisateurs';
import { useParametresEntreprise } from '@/hooks/parametrage/useParametresEntreprise';
import { useMotifsRendezVous } from '@/hooks/rendez-vous/useMotifsRendezVous';
import { useSession } from '@/hooks/useSession';

import { calculerEtapesDemarrage, demarrageComplet, type EtapeDemarrage } from './etapes-demarrage';

export interface EtatDemarrage {
  readonly etapes: readonly EtapeDemarrage[];
  /** Au moins une source n'a pas encore répondu : on affiche un squelette, pas un état faux. */
  readonly enChargement: boolean;
  readonly complet: boolean;
  readonly reessayer: () => void;
}

/**
 * État réel de la mise en route du garage, calculé depuis les données du serveur (jamais une case
 * cochée à la main) via les mêmes requêtes que les écrans de réglage : une fois l'étape réglée
 * et la requête invalidée, la liste se met à jour sans rechargement.
 */
export function useEtapesDemarrage(): EtatDemarrage {
  const { data: session } = useSession();
  const creancier = useBlocCreancier();
  const entreprise = useParametresEntreprise();
  const tauxHoraires = useListeTauxHoraires();
  const motifs = useMotifsRendezVous();
  const utilisateurs = useListeUtilisateurs();
  const bornes = useListeBornes();

  const requetes = [creancier, entreprise, tauxHoraires, motifs, utilisateurs, bornes];
  const enChargement = requetes.some((r) => r.isPending);

  const etapes = useMemo(
    () =>
      calculerEtapesDemarrage({
        creancier: creancier.data,
        numeroTva: entreprise.data ? entreprise.data.numeroTva : undefined,
        nbTauxHoraires: tauxHoraires.data?.pages[0]?.donnees.length,
        motifs: motifs.data,
        utilisateurs: utilisateurs.data?.pages.flatMap((p) => p.donnees),
        nbBornes: bornes.data?.pages[0]?.donnees.length,
        utilisateurCourantId: session?.utilisateur.id,
      }),
    [
      creancier.data,
      entreprise.data,
      tauxHoraires.data,
      motifs.data,
      utilisateurs.data,
      bornes.data,
      session?.utilisateur.id,
    ],
  );

  return {
    etapes,
    enChargement,
    complet: !enChargement && demarrageComplet(etapes),
    reessayer: () => {
      for (const r of requetes) if (r.isError) void r.refetch();
    },
  };
}
