import { keepPreviousData, useQuery } from '@tanstack/react-query';

import type { ReponseRecherche, ResultatRecherche } from '@dfa/shared';

import { requeteApi } from '@/api/client';
import { useValeurDebouncee } from '@/hooks/commun/useValeurDebouncee';

export type NatureRecherchee = 'vehicule' | 'client';

const LIMITE = 8;

async function chercher(q: string, nature: NatureRecherchee): Promise<ReponseRecherche> {
  const parametres = new URLSearchParams({ q, limite: String(LIMITE) });
  parametres.append('types', nature);
  const reponse = await requeteApi<ReponseRecherche>(`/recherche?${parametres.toString()}`, {
    method: 'GET',
  });
  if (!reponse) throw new Error('Réponse de recherche inattendue : corps vide.');
  return reponse;
}

export interface RechercheTypee {
  readonly resultats: readonly ResultatRecherche[];
  readonly plaqueInterchangeable: boolean;
  /** Saisie assez longue pour chercher (sinon aucun appel, ni « aucun résultat »). */
  readonly active: boolean;
  /** Anti-rebond en cours ou requête en vol : aucun résultat fiable pour la saisie courante. */
  readonly enChargement: boolean;
  readonly enErreur: boolean;
  readonly erreur: unknown;
  readonly relancer: () => void;
}

/**
 * Même moteur que la recherche Ctrl+K (`GET /recherche`, normalisation de la plaque côté serveur),
 * restreint à UNE nature. Sert à reconnaître une plaque ou à retrouver un client dans l'écran
 * « ouvrir un OR », sans quitter l'écran ni ouvrir de dialogue.
 */
export function useRechercheTypee(
  saisie: string,
  nature: NatureRecherchee,
  longueurMin = 2,
): RechercheTypee {
  const [temporisee] = useValeurDebouncee(saisie, 300);
  const terme = temporisee.trim();
  const active = saisie.trim().length >= longueurMin;
  const requete = useQuery({
    queryKey: ['recherche', 'typee', nature, terme],
    queryFn: () => chercher(terme, nature),
    enabled: terme.length >= longueurMin,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const enChargement = active && (terme !== saisie.trim() || requete.isFetching);
  return {
    resultats: active ? (requete.data?.resultats ?? []) : [],
    plaqueInterchangeable: active && requete.data?.plaqueInterchangeable === true,
    active,
    enChargement,
    enErreur: requete.isError,
    erreur: requete.error,
    relancer: () => void requete.refetch(),
  };
}
