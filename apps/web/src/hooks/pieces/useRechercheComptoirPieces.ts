import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import type { ResultatRechercheComptoirArticle } from '@dfa/shared';

import { clesPieces } from './cles';
import { rechercheComptoirArticles } from './articles.api';

/** Anti-rebond de la frappe — même valeur et même raison que `useRechercheComptoir` (recherche
 *  transverse, `hooks/recherche/useRechercheComptoir.ts`) : le client attend au comptoir, on
 *  n'interroge le serveur qu'une fois la frappe stabilisée. */
const DELAI_ANTI_REBOND_MS = 300;

const LIMITE_RESULTATS = 10;

export interface EtatRechercheComptoirPieces {
  readonly saisie: string;
  readonly onSaisieChange: (valeur: string) => void;
  /** `true` dès que la saisie n'est pas vide et qu'aucun résultat stabilisé pour ELLE n'est
   *  encore disponible (anti-rebond en cours ou requête en vol). */
  readonly enChargement: boolean;
  /** `null` tant que la saisie est vide OU qu'aucun site n'est sélectionné — dans les deux cas,
   *  l'écran doit inviter à agir, jamais afficher « aucun résultat ». */
  readonly resultats: readonly ResultatRechercheComptoirArticle[] | null;
  readonly enErreur: boolean;
  readonly erreur: unknown;
  readonly relancer: () => void;
}

/**
 * État complet de la recherche comptoir pièces (`GET /articles/recherche-comptoir`) — LE geste le
 * plus fréquent du magasinier : un client au comptoir, une référence, « est-ce que je l'ai, et à
 * quel prix ». Même architecture que `useRechercheComptoir` (recherche transverse) : saisie
 * contrôlée, anti-rebond, dérivation chargement/vide/erreur — mais paramétrée par un `siteId`
 * obligatoire (la disponibilité annoncée au comptoir n'a de sens que POUR un site).
 */
export function useRechercheComptoirPieces(
  siteId: string | undefined,
): EtatRechercheComptoirPieces {
  const [saisie, setSaisie] = useState('');
  const [termeDebounce, setTermeDebounce] = useState('');

  useEffect(() => {
    const termeCible = saisie.trim();
    const identifiant = window.setTimeout(() => setTermeDebounce(termeCible), DELAI_ANTI_REBOND_MS);
    return () => window.clearTimeout(identifiant);
  }, [saisie]);

  const requete: UseQueryResult<readonly ResultatRechercheComptoirArticle[]> = useQuery({
    queryKey: clesPieces.articles.rechercheComptoir(termeDebounce, siteId ?? ''),
    queryFn: () =>
      rechercheComptoirArticles({
        q: termeDebounce,
        siteId: siteId as string,
        limite: LIMITE_RESULTATS,
      }),
    enabled: termeDebounce.length > 0 && siteId !== undefined,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

  const saisieNonVide = saisie.trim().length > 0;
  const enChargement =
    siteId !== undefined &&
    saisieNonVide &&
    (termeDebounce !== saisie.trim() || requete.isFetching);

  return {
    saisie,
    onSaisieChange: setSaisie,
    enChargement,
    resultats: siteId !== undefined && saisieNonVide ? (requete.data ?? null) : null,
    enErreur: requete.isError,
    erreur: requete.error,
    relancer: () => void requete.refetch(),
  };
}
