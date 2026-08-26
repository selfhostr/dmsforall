import { useState } from 'react';
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ReponseRecherche } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { requeteApi } from '@/api/client';
import { useValeurDebouncee } from '@/hooks/commun/useValeurDebouncee';

/** Anti-rebond de la frappe (D-08, RM-112) : le garagiste tape une plaque pendant que le client
 *  attend au comptoir — on n'interroge le serveur qu'une fois la frappe stabilisée, jamais à
 *  chaque caractère. 300ms est le compromis standard entre réactivité perçue et volume de
 *  requêtes ; à ajuster ici seulement si l'usage réel du comptoir le justifie. */
const DELAI_ANTI_REBOND_MS = 300;

/** `GET /recherche` — la normalisation de `q` reste strictement serveur (§7.5) : ce hook ne fait
 *  que `trim()` avant envoi (éviter une requête sur une saisie faite uniquement d'espaces), il ne
 *  réplique jamais la normalisation serveur (casse, accents, plaque…). */
async function executerRecherche(q: string): Promise<ReponseRecherche> {
  const parametres = new URLSearchParams({ q });
  const reponse = await requeteApi<ReponseRecherche>(`/recherche?${parametres.toString()}`, {
    method: 'GET',
  });
  if (!reponse) {
    throw new Error('Réponse de recherche inattendue : corps vide.');
  }
  return reponse;
}

export interface EtatRechercheComptoir {
  /** Valeur affichée dans le champ, mise à jour à chaque frappe — jamais de perte de saisie
   *  pendant l'anti-rebond ou une requête en vol. */
  readonly saisie: string;
  readonly onSaisieChange: (valeur: string) => void;
  /** `true` dès que la saisie n'est pas vide et qu'aucun résultat stabilisé pour ELLE n'est
   *  encore disponible (anti-rebond en cours ou requête en vol) — distinct de « saisie vide »,
   *  qui n'est pas un état de chargement. */
  readonly enChargement: boolean;
  /** `null` tant que la saisie est vide (rien à chercher) : l'écran doit alors inviter à taper,
   *  jamais afficher « aucun résultat ». */
  readonly reponse: ReponseRecherche | null;
  readonly enErreur: boolean;
  readonly erreur: unknown;
  readonly relancer: () => void;
}

/**
 * État complet de l'écran de recherche comptoir (F1-R2) : saisie contrôlée, anti-rebond,
 * requête `GET /recherche` et dérivation des trois états d'écran (chargement/vide/erreur).
 * Le composant appelant (`PanneauResultatsRecherche`) reste purement présentationnel — toute la
 * logique réseau et de timing vit ici, testable sans rendu.
 */
export function useRechercheComptoir(): EtatRechercheComptoir {
  const [saisie, setSaisie] = useState('');
  // `.trim()` après la temporisation — même valeur finale que l'ancien `termeCible = saisie.trim()`
  // évalué à l'armement du minuteur (le `.trim()` est pur et `saisie` ne change plus entre-temps),
  // mais le réarmement reste piloté par la saisie BRUTE (comme avant), pas par sa forme réduite.
  const [saisieTemporisee] = useValeurDebouncee(saisie, DELAI_ANTI_REBOND_MS);
  const termeDebounce = saisieTemporisee.trim();

  const requete: UseQueryResult<ReponseRecherche> = useQuery({
    queryKey: clesQuery.recherche.globale(termeDebounce),
    queryFn: () => executerRecherche(termeDebounce),
    enabled: termeDebounce.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const saisieNonVide = saisie.trim().length > 0;
  // Anti-rebond pas encore écoulé (termeDebounce en retard sur saisie) OU requête en vol pour le
  // terme déjà stabilisé : dans les deux cas, aucun résultat fiable pour la saisie COURANTE.
  const enChargement = saisieNonVide && (termeDebounce !== saisie.trim() || requete.isFetching);

  return {
    saisie,
    onSaisieChange: setSaisie,
    enChargement,
    reponse: saisieNonVide ? (requete.data ?? null) : null,
    enErreur: requete.isError,
    erreur: requete.error,
    relancer: () => void requete.refetch(),
  };
}
