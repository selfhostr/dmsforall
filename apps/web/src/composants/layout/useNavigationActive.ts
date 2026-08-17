import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useLocation, useSearchParams } from 'react-router';

import type { RoleUtilisateur, SessionCourante } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { recupererSessionCourante } from '@/api/session';
import { useSiteCourant } from '@/hooks/site/ContexteSiteCourant';

import {
  ongletsVisibles,
  trouverCorrespondance,
  vuesVisibles,
  type CorrespondanceNavigation,
  type OngletDomaine,
  type VueDomaine,
} from './navigation-modele';

/**
 * `useLocation`/`useSearchParams` EXIGENT un `<Router>` ancêtre — invariant de react-router,
 * `useLocation() may be used only in the context of a <Router> component`. `OngletsDomaine`
 * l'exigeait déjà avant ce chantier, mais `GabaritEcran` (`composants/motifs/GabaritEcran.tsx`) est
 * monté par des dizaines d'écrans dont certaines specs isolées ne fournissaient PAS de Router de
 * test — elles n'en avaient jamais eu besoin, `GabaritEcran` v1 ne posait aucun hook. Sans cette
 * tolérance, la détection automatique de doublon aurait cassé d'un coup tout appelant existant, y
 * compris ceux dont l'écran ne touche à rien de la navigation, avec un message d'erreur qui ne dit
 * rien du vrai fautif (`useLocation`, jamais `GabaritEcran`). Constaté sur `EcranRelances.spec.tsx`
 * (agent facturation, 17.08.2026), corrigé en amont ici plutôt que redemandé écran par écran :
 * hors Router, on dégrade vers « aucune route connue » — EXACTEMENT le même résultat qu'une URL
 * hors arborescence (`trouverCorrespondance` retourne `undefined`, §3 du contrat : titre visible
 * par défaut, aucun plantage). `useLocation`/`useSearchParams` restent appelés SANS condition à
 * chaque rendu (un seul et même appel, capturé par le `try`) : ce qui varie est seulement si
 * l'exception qu'ils lèvent en interne est absorbée, jamais le nombre ni l'ordre des hooks appelés
 * pour une instance de composant donnée — les règles des hooks React restent respectées.
 */
function useCheminTolerantAuRouteur(): string {
  try {
    return useLocation().pathname;
  } catch {
    return '';
  }
}

/** Même tolérance que `useCheminTolerantAuRouteur` ci-dessus, pour `useSearchParams`. */
function useParametresRechercheTolerants(): URLSearchParams {
  try {
    return useSearchParams()[0];
  } catch {
    return new URLSearchParams();
  }
}

/**
 * MÊME requête que `useSession()` (`hooks/useSession.ts`), SANS `refetchOnMount` : ce composant est
 * monté par des dizaines d'écrans, souvent bien APRÈS qu'un autre observateur (typiquement
 * `RouteProtegee`) a déjà déclenché et résolu la requête de session — y compris vers une ERREUR.
 * `refetchOnMount` par défaut (`true`) referait alors une tentative pour CE nouvel observateur ; sur
 * un scénario qui simule justement une session qui ne se résout jamais une seconde fois
 * (`routes/EcranServiceIndisponible.tsx`, monté PAR `RouteProtegee` précisément quand la session est
 * en erreur), cette tentative restait bloquée. Constaté en exécution,
 * `routes/RouteProtegee.spec.tsx` (test « isError ») : 15 secondes de blocage avant ce correctif.
 *
 * `refetchOnMount: false` n'empêche PAS la toute première requête d'une session encore jamais
 * interrogée par personne (`data === undefined` sans historique déclenche quand même un fetch —
 * comportement TanStack Query, nécessaire pour qu'`OngletsDomaine`/`GabaritEcran` restent capables
 * de résoudre le rôle seuls, montés hors `RouteProtegee`, dans une spec isolée par exemple) : il
 * empêche seulement la requête SUPPLÉMENTAIRE, inutile et potentiellement bloquante, d'un second
 * observateur qui arrive après coup sur une requête déjà connue (résolue OU en erreur). Dans les
 * deux cas (chargement encore en cours, ou erreur), `data` reste `undefined` ici : aucun libellé de
 * nav gouverné par rôle n'est alors considéré affiché, donc pas de doublon détecté, titre visible —
 * même dégradé qu'une route hors arborescence (§3 du contrat), jamais un blocage, jamais une
 * suspension, exactement la doctrine déjà suivie par `OngletsDomaine` (« la rangée s'enrichit, elle
 * ne clignote pas »).
 */
function useRoleSession(): RoleUtilisateur | undefined {
  const { data } = useQuery<SessionCourante | null>({
    queryKey: clesQuery.session(),
    queryFn: recupererSessionCourante,
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnMount: false,
  });
  return data?.utilisateur.role;
}

export interface NavigationActive {
  /** `undefined` pour une URL hors arborescence — voir `trouverCorrespondance`. */
  readonly correspondance: CorrespondanceNavigation | undefined;
  readonly site: string | undefined;
  /** Onglets du domaine courant VISIBLES pour le rôle en session — jamais recalculés ailleurs. */
  readonly onglets: readonly OngletDomaine[];
  /** Vues de l'onglet courant VISIBLES pour le rôle en session. */
  readonly vues: readonly VueDomaine[];
  /** `OngletsDomaine` ne rend la rangée d'onglets QUE s'il y a plus d'un choix — voir son en-tête. */
  readonly afficheOnglets: boolean;
  /** Même règle pour la rangée de vues. */
  readonly afficheVues: boolean;
}

/**
 * RÉSOLUTION DE NAVIGATION — source unique de « où suis-je, et qu'est-ce qui est RÉELLEMENT
 * affiché pour le dire ». `OngletsDomaine` (qui rend la rangée d'onglets/vues) et
 * `useLibellesNavigationAffiches` (qui alimente la détection de titre en double de `GabaritEcran`,
 * `composants/motifs/GabaritEcran.tsx`) consomment tous les deux ce hook plutôt que de recalculer
 * `trouverCorrespondance`/`ongletsVisibles`/`vuesVisibles` chacun de leur côté — un onglet qui
 * n'est pas rendu par manque de droit (rôle sans accès) ou par manque de choix (un seul élément,
 * §3 du contrat « titres doublés & espacements ») ne doit JAMAIS compter comme « affiché » côté
 * détection de doublon, sous peine de masquer un titre que rien à l'écran ne porte plus.
 */
export function useNavigationActive(): NavigationActive {
  const pathname = useCheminTolerantAuRouteur();
  const searchParams = useParametresRechercheTolerants();
  const { preferenceSiteId } = useSiteCourant();
  // Même correctif que `BarreLaterale.tsx`/`OngletsDomaine.tsx` (issue #91) : l'URL fait foi, la
  // préférence ne comble que son absence.
  const site = searchParams.get('site') ?? preferenceSiteId;
  const role = useRoleSession();

  const correspondance = trouverCorrespondance(pathname);
  if (correspondance === undefined) {
    return {
      correspondance: undefined,
      site,
      onglets: [],
      vues: [],
      afficheOnglets: false,
      afficheVues: false,
    };
  }

  const onglets = ongletsVisibles(correspondance.entree, role);
  const vues = vuesVisibles(correspondance.onglet, role);

  return {
    correspondance,
    site,
    onglets,
    vues,
    afficheOnglets: onglets.length > 1,
    afficheVues: vues.length > 1,
  };
}

/**
 * Libellés de navigation EFFECTIVEMENT rendus à l'écran pour la route courante, du plus profond au
 * plus large (§3 du contrat) : la vue active si sa rangée est rendue, l'onglet actif si sa rangée
 * est rendue, l'entrée active de la barre latérale (`BarreLaterale.tsx`) — celle-ci TOUJOURS,
 * qu'elle soit repliée ou non : `BarreLaterale` ne retire jamais le libellé du DOM, elle le rend
 * `sr-only` en repli, ce qui suffit à en faire un repère de navigation légitime pour la détection.
 *
 * Chaînes déjà traduites dans la langue courante (namespace `navigation`) : `GabaritEcran` les
 * compare directement à sa prop `titre`, elle aussi déjà traduite par l'écran appelant.
 */
export function useLibellesNavigationAffiches(): readonly string[] {
  const { t } = useTranslation('navigation');
  const { correspondance, afficheOnglets, afficheVues } = useNavigationActive();
  if (correspondance === undefined) return [];

  const libelles: string[] = [];
  if (afficheVues && correspondance.vue !== undefined) {
    libelles.push(t(correspondance.vue.cleLibelle));
  }
  if (afficheOnglets) {
    libelles.push(t(correspondance.onglet.cleLibelle));
  }
  libelles.push(t(correspondance.entree.cleLibelle));
  return libelles;
}
