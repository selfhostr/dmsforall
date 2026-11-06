/**
 * Patron unique de lecture d'une collection paginée par curseur (`PageCurseur`, contrat API).
 *
 * Ce fichier existe parce que le même bloc `useInfiniteQuery` + aplatissement des pages était
 * recopié à l'identique dans une vingtaine de hooks de domaine. Ce n'était pas qu'une question de
 * volume : chaque copie devait se souvenir SEULE de désactiver la requête tant que sa dépendance
 * (`clientId`, `siteId`, `articleId`…) n'était pas résolue. Deux hooks l'avaient oublié, et le
 * défaut n'était visible ni au typage ni aux tests — la copie suivante l'aurait réintroduit.
 *
 * ## Comment la garde devient structurelle
 *
 * `charger` n'est pas « une fonction plus un booléen `enabled` à côté » : c'est
 * `ChargeurPage<T> | undefined`, et `undefined` SIGNIFIE « pas encore chargeable ».
 * `useListeCurseur` en déduit lui-même `enabled: false` — il n'y a pas de chemin où l'appelant
 * fournit un chargeur sans que la requête soit activée, ni l'inverse.
 *
 * Le bénéfice réel se voit côté appelant. Un hook dont la dépendance est facultative écrit :
 *
 * ```ts
 * charger:
 *   articleId === undefined
 *     ? undefined
 *     : (curseur) => listerMouvementsArticle(articleId, filtres, { limite, curseur }),
 * ```
 *
 * Dans la branche non-`undefined`, TypeScript a rétréci `articleId` à `string` : l'appel compile
 * sans transtypage. S'il OUBLIE la garde, `articleId` reste `string | undefined` et l'appel à
 * `listerMouvementsArticle` **ne compile pas**. C'est ce qui rend l'oubli impossible : avant cette
 * factorisation, la même erreur se rattrapait par un `articleId as string` dans la `queryFn` — un
 * transtypage silencieux, précisément le mécanisme qui masquait l'absence de garde. Ces
 * transtypages ont tous disparu à la migration.
 *
 * `actif` reste disponible pour une garde qui ne découle PAS d'une dépendance manquante (onglet
 * inactif, recherche encore vide, droit absent connu d'avance côté front).
 */

import {
  useInfiniteQuery,
  useQueryClient,
  type DefaultError,
  type InfiniteData,
  type QueryKey,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';

import type { PageCurseur } from '@dfa/shared';

import { ErreurApi } from '@/api/erreurs';
import { FRAICHEUR_REFERENTIEL_MS } from '@/api/reessai';

/** Charge UNE page. `curseur === undefined` désigne la première page — jamais un numéro de page
 *  (contrat `PageCurseur` : `BoutonChargerPlus`, pas de pagination numérotée). */
export type ChargeurPage<T> = (curseur: string | undefined) => Promise<PageCurseur<T>>;

export interface OptionsListeCurseur<T> {
  /** Clé de cache, telle que produite par la fabrique de clés du domaine (`clesPieces.…`). */
  readonly cle: QueryKey;
  /** `undefined` ⇒ dépendance non résolue ⇒ requête désactivée. Voir l'en-tête du fichier. */
  readonly charger: ChargeurPage<T> | undefined;
  /** Garde SUPPLÉMENTAIRE de l'appelant, indépendante des dépendances. `undefined` ⇒ pas de
   *  garde (comportement identique à l'omission de `enabled` côté TanStack Query). */
  readonly actif?: boolean;
  /** Politique de réessai. Omise ⇒ défaut du `QueryClient` (3 tentatives en applicatif, `false`
   *  dans les tests). À fournir quand un état d'échec est STABLE (403/404 : aucun réessai ne le
   *  résoudra jamais). */
  readonly reessayer?: PolitiqueReessai;
  /** Fraîcheur de la liste. `'toujours-frais'` : liste critique (pointage…) rechargée à chaque
   *  montage et au retour sur l'onglet. `'referentiel'` : donnée quasi statique, gardée 5 min.
   *  Omis ⇒ défaut du `QueryClient`. */
  readonly fraicheur?: 'toujours-frais' | 'referentiel';
}

/** Signature de `retry` côté TanStack Query, redite ici pour ne pas dépendre d'un type interne. */
export type PolitiqueReessai = (nombreEchecs: number, erreur: DefaultError) => boolean;

/** Un `403 DROIT_INSUFFISANT` ou un `404 RESSOURCE_INTROUVABLE` est un état STABLE : aucun
 *  réessai ne le résoudra jamais, contrairement à une panne réseau ou un `5xx` transitoire.
 *  Sans cette garde, le comportement par défaut de TanStack Query (jusqu'à 3 réessais, délai
 *  exponentiel) transforme un refus de droit en martèlement réseau continu — même défaut mesuré
 *  que celui corrigé sur `useListeDossiersVente` (`hooks/ventes/dossiers/`), dont ce module
 *  reprend exactement la politique. */
function estRefusStable(erreur: unknown): boolean {
  return (
    erreur instanceof ErreurApi &&
    (erreur.probleme.status === 403 || erreur.probleme.status === 404)
  );
}

/**
 * Politique de réessai partagée par tout hook de domaine qui a une raison de dévier du défaut du
 * `QueryClient` ambiant : ne dévie que sur un refus stable (403/404, cf. `estRefusStable`) — pour
 * tout le reste, elle rejoue EXACTEMENT la décision que le `QueryClient` aurait prise si aucun
 * `retry` n'avait été fourni.
 *
 * Pourquoi ceci ne peut pas être une simple fonction figée (l'ancienne forme de
 * `doitReessayer`, `nombreEchecs < 3` codé en dur) : `useListeCurseur` (voir son en-tête, « clé
 * conditionnellement absente ») laisse le défaut du client jouer en OMETTANT `retry` — mais ça ne
 * fonctionne que quand l'appelant n'a AUCUNE politique à faire valoir. Ici il en existe une (le
 * refus stable), donc une fonction `retry` non-`undefined` doit forcément être fournie — et une
 * fois fournie, TanStack Query n'offre aucun moyen de dire « pour ce cas-là, utilise plutôt le
 * défaut ». La seule façon de « laisser le reste au client » est donc de LIRE le défaut
 * réellement configuré sur ce `QueryClient` (`getDefaultOptions().queries.retry` — la même valeur
 * que le moteur de requêtes utilise en interne, `config.retry ?? 3`, cf.
 * `@tanstack/query-core/retryer.ts`) et de rejouer sa décision nous-mêmes pour tout ce qui n'est
 * pas un refus stable.
 *
 * Bug corrigé par cette composition : l'ancienne fonction figée imposait TOUJOURS jusqu'à trois
 * réessais sur un 5xx — y compris dans les tests, dont le `QueryClient` pose `retry: false`
 * précisément pour observer l'état d'erreur sans attendre. Une fonction `retry` explicite
 * l'emporte TOUJOURS sur le défaut du client (fusion par étalement dans
 * `QueryClient.defaultQueryOptions`) — la lire nous-mêmes est la seule manière de ne pas perdre ce
 * défaut en cours de route.
 *
 * Un hook, pas une fonction pure : lire le `QueryClient` ambiant exige `useQueryClient()`. Chaque
 * hook de domaine l'appelle donc au même titre que `useListeCurseur`/`useQuery`, et transmet le
 * résultat en `reessayer`/`retry`.
 */
export function useDoitReessayer(): PolitiqueReessai {
  const queryClient = useQueryClient();
  return (nombreEchecs, erreur) => {
    if (estRefusStable(erreur)) return false;
    const defautRetry = queryClient.getDefaultOptions().queries?.retry;
    if (typeof defautRetry === 'function') return defautRetry(nombreEchecs, erreur);
    if (typeof defautRetry === 'number') return nombreEchecs < defautRetry;
    if (typeof defautRetry === 'boolean') return defautRetry;
    // Défaut non configuré sur ce client : reproduit le comportement interne de TanStack Query
    // quand `retry` est complètement absent (`config.retry ?? 3`).
    return nombreEchecs < 3;
  };
}

export interface ListeCurseur<T> {
  /** Le résultat brut de TanStack Query — c'est lui que les hooks de domaine étalent dans leur
   *  valeur de retour, exactement comme avant la factorisation. */
  readonly resultat: UseInfiniteQueryResult<InfiniteData<PageCurseur<T>>, DefaultError>;
  /** Toutes les pages chargées, aplaties. Un NOUVEAU tableau à chaque rendu, délibérément : les
   *  hooks d'origine faisaient de même, et mémoïser stabiliserait une identité sur laquelle des
   *  écrans hors périmètre pourraient déjà compter (ou non) dans leurs dépendances d'effet. */
  readonly elements: readonly T[];
}

export function useListeCurseur<T>({
  cle,
  charger,
  actif,
  reessayer,
  fraicheur,
}: OptionsListeCurseur<T>): ListeCurseur<T> {
  // La clé `retry` doit être ABSENTE, pas `undefined`, quand l'appelant n'en veut pas :
  // `QueryClient.defaultQueryOptions` fusionne par étalement (`{...defaults.queries, ...options}`),
  // donc un `retry: undefined` explicite ÉCRASE le défaut du client au lieu de le laisser jouer —
  // il suffirait à réactiver 3 réessais dans les tests, dont le `QueryClient` pose `retry: false`.
  const optionsReessai: { retry?: PolitiqueReessai } =
    reessayer === undefined ? {} : { retry: reessayer };

  // Même précaution que pour `retry` : les clés sont ABSENTES quand l'appelant n'en veut pas.
  const optionsFraicheur =
    fraicheur === 'toujours-frais'
      ? { staleTime: 0, refetchOnWindowFocus: true }
      : fraicheur === 'referentiel'
        ? { staleTime: FRAICHEUR_REFERENTIEL_MS }
        : {};

  const resultat = useInfiniteQuery({
    ...optionsReessai,
    ...optionsFraicheur,
    queryKey: cle,
    queryFn: ({ pageParam }: { pageParam: string | undefined }) => {
      if (charger === undefined) {
        // Inatteignable : `enabled` vaut `false` dès que `charger` est absent. Lever plutôt que
        // renvoyer une page vide — une page vide se lirait comme « le serveur n'a rien », alors
        // qu'il s'agirait d'un défaut de câblage (cf. « une absence de donnée n'est pas une
        // valeur »).
        throw new Error(
          `Liste paginée sans chargeur : la requête ${JSON.stringify(cle)} aurait dû rester désactivée.`,
        );
      }
      return charger(pageParam);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (dernierePage) => dernierePage.curseurSuivant ?? undefined,
    enabled: charger !== undefined && (actif ?? true),
  });

  return {
    resultat,
    elements: resultat.data?.pages.flatMap((page) => page.donnees) ?? [],
  };
}
