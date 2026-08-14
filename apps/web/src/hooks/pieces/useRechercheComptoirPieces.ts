import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery, type UseQueryResult } from '@tanstack/react-query';

import type {
  ReponseArticle,
  ResultatRechercheComptoirArticle,
  StatutSuiviStockArticle,
} from '@dfa/shared';

import { useDoitReessayer, useListeCurseur } from '@/hooks/pagination-curseur';

import { clesPieces } from './cles';
import {
  listerArticles,
  rechercheComptoirArticles,
  type FiltresListeArticles,
} from './articles.api';

/** Anti-rebond de la frappe — même valeur et même raison que `useRechercheComptoir` (recherche
 *  transverse, `hooks/recherche/useRechercheComptoir.ts`) : le client attend au comptoir, on
 *  n'interroge le serveur qu'une fois la frappe stabilisée. */
const DELAI_ANTI_REBOND_MS = 300;

const LIMITE_RESULTATS_RECHERCHE = 10;

/** Taille de page en mode PARCOURS (liste par défaut, saisie vide) — plus large que le résultat
 *  borné de la recherche (`LIMITE_RESULTATS_RECHERCHE`, saisie assistée non exhaustive) puisque
 *  parcourir EST le but ici, mais reste raisonnable pour un geste comptoir sur tablette. */
const LIMITE_PAGE_PARCOURS = 20;

/**
 * Filtres du mode PARCOURS — articles actifs uniquement (même filtre que `rechercheComptoir`
 * côté serveur : `a.statut = 'actif'`), triés par désignation pour un défilement prévisible.
 * Objet stable (littéral figé hors composant) : sa valeur ne change jamais, seule sa présence
 * dans `queryKey` compte pour TanStack Query (comparaison profonde, pas de référence).
 */
const FILTRES_PARCOURS: FiltresListeArticles = { statut: 'actif', tri: 'designation:asc' };

/** `ReponseArticle` (endpoint catalogue, déjà stable et sans dépendance au contrat en cours côté
 *  serveur) -> même forme que `ResultatRechercheComptoirArticle` (endpoint recherche comptoir) —
 *  permet à l'écran de consommer UNE seule forme de résultat quel que soit le mode. `emplacement`
 *  n'existe pas sur le résumé de stock embarqué (`StockResumeArticle`, contrairement au détail
 *  complet `ReponseStockArticle`) : `null`, jamais deviné. Un site sans entrée dans
 *  `stocksResume` (article jamais mouvementé sur ce site) compte pour 0 disponible — même
 *  décision que la colonne « disponible » de `EcranListeArticles` : dans les deux cas, la réponse
 *  utile au magasinier est identique (« rien à sortir aujourd'hui sur ce site »).
 *
 * `statutSuivi` est dérivable de `stocksResume` (qui ne liste que les sites avec activité/seuil) :
 *  - entrée pour CE site → `'suivi'` ;
 *  - pas d'entrée pour CE site, mais existe ailleurs → `'nonSuiviSurCeSite'` ;
 *  - aucune entrée nulle part → `'nonSuiviNullePart'`.
 */
function versResultatParcours(
  article: ReponseArticle,
  siteId: string,
): ResultatRechercheComptoirArticle {
  const stock = article.stocksResume.find((resume) => resume.siteId === siteId);
  const statutSuivi: StatutSuiviStockArticle = stock
    ? 'suivi'
    : article.stocksResume.length > 0
      ? 'nonSuiviSurCeSite'
      : 'nonSuiviNullePart';
  return {
    articleId: article.id,
    numeroArticle: article.numeroArticle,
    designation: article.designation,
    referencePrincipale: article.referencePrincipale,
    prixVenteTtcCentimes: article.prixVenteTtcCentimes,
    quantiteDisponibleMillieme: stock?.quantiteDisponibleMillieme ?? 0,
    statutSuivi,
    emplacement: null,
    estEchangeStandard: article.estEchangeStandard,
    montantConsigneTtcCentimes: article.montantConsigneTtcCentimes,
  };
}

export interface EtatRechercheComptoirPieces {
  readonly saisie: string;
  readonly onSaisieChange: (valeur: string) => void;
  /** `true` tant que la saisie est vide : l'écran affiche alors la liste PARCOURABLE (catalogue
   *  actif du site, paginée), pas une case vide en attente d'une référence connue d'avance
   *  (constat testeur : « il faut taper une référence que je ne connais pas »). */
  readonly enParcours: boolean;
  /** `true` dès qu'aucun résultat stabilisé pour l'état courant (saisie + mode) n'est encore
   *  disponible (anti-rebond en cours ou requête en vol). */
  readonly enChargement: boolean;
  /** `null` UNIQUEMENT tant qu'aucun site n'est sélectionné — l'écran doit alors inviter à en
   *  choisir un, jamais afficher « aucun résultat ». */
  readonly resultats: readonly ResultatRechercheComptoirArticle[] | null;
  readonly enErreur: boolean;
  readonly erreur: unknown;
  readonly relancer: () => void;
  /** Pagination du mode PARCOURS uniquement (`BoutonChargerPlus`) — toujours `false` en mode
   *  recherche (résultat borné, non paginé, voir `schemaRechercheComptoir`). */
  readonly aDavantage: boolean;
  readonly chargementSuivant: boolean;
  readonly chargerDavantage: () => void;
}

/**
 * État complet de la recherche comptoir pièces (`GET /articles/recherche-comptoir` en mode
 * recherche, `GET /articles` en mode parcours). LE geste le plus fréquent du magasinier : un
 * client au comptoir, une référence — OU, faute de la connaître, une liste à parcourir. Paramétré
 * par un `siteId` obligatoire (la disponibilité annoncée au comptoir n'a de sens que POUR un
 * site), même garde que `useParametresSite`.
 *
 * Mode PARCOURS (`saisie` vide) : réutilise l'endpoint catalogue déjà stable (`/articles`, filtré
 * `statut=actif`, trié par désignation, paginé par curseur) — PAS `recherche-comptoir`, dont le
 * contrat exige aujourd'hui `q` non vide (`schemaRechercheComptoir.q.min(1)`) et dont l'évolution
 * ventuelle (recherche sans terme) est un chantier serveur mené EN PARALLÈLE, hors périmètre de ce
 * fichier. Ce choix rend le mode parcours indépendant de ce chantier : il fonctionne dès
 * aujourd'hui avec le contrat existant.
 *
 * Mode RECHERCHE (`saisie` non vide) : inchangé, `GET /articles/recherche-comptoir` — le serveur y
 * fait déjà une recherche `ilike` sur désignation, référence principale ET références
 * alternatives (`service-article.ts::rechercheComptoir`), donc un bout de désignation aboutit déjà
 * sans changement de contrat.
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

  const enParcours = termeDebounce === '';
  const reessayer = useDoitReessayer();

  const { resultat: resultatParcours, elements: articlesParcours } =
    useListeCurseur<ReponseArticle>({
      cle: clesPieces.articles.liste(FILTRES_PARCOURS),
      charger:
        enParcours && siteId !== undefined
          ? (curseur) => listerArticles(FILTRES_PARCOURS, { limite: LIMITE_PAGE_PARCOURS, curseur })
          : undefined,
      reessayer,
    });

  const requeteRecherche: UseQueryResult<readonly ResultatRechercheComptoirArticle[]> = useQuery({
    queryKey: clesPieces.articles.rechercheComptoir(termeDebounce, siteId ?? ''),
    queryFn: () =>
      rechercheComptoirArticles({
        q: termeDebounce,
        siteId: siteId as string,
        limite: LIMITE_RESULTATS_RECHERCHE,
      }),
    enabled: !enParcours && siteId !== undefined,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

  if (siteId === undefined) {
    return {
      saisie,
      onSaisieChange: setSaisie,
      enParcours,
      enChargement: false,
      resultats: null,
      enErreur: false,
      erreur: null,
      relancer: () => {},
      aDavantage: false,
      chargementSuivant: false,
      chargerDavantage: () => {},
    };
  }

  if (enParcours) {
    return {
      saisie,
      onSaisieChange: setSaisie,
      enParcours,
      enChargement: resultatParcours.isPending,
      resultats: articlesParcours.map((article) => versResultatParcours(article, siteId)),
      enErreur: resultatParcours.isError,
      erreur: resultatParcours.error,
      relancer: () => void resultatParcours.refetch(),
      aDavantage: Boolean(resultatParcours.hasNextPage),
      chargementSuivant: resultatParcours.isFetchingNextPage,
      chargerDavantage: () => void resultatParcours.fetchNextPage(),
    };
  }

  const enChargementRecherche = termeDebounce !== saisie.trim() || requeteRecherche.isFetching;

  return {
    saisie,
    onSaisieChange: setSaisie,
    enParcours,
    enChargement: enChargementRecherche,
    resultats: requeteRecherche.data ?? null,
    enErreur: requeteRecherche.isError,
    erreur: requeteRecherche.error,
    relancer: () => void requeteRecherche.refetch(),
    aDavantage: false,
    chargementSuivant: false,
    chargerDavantage: () => {},
  };
}
