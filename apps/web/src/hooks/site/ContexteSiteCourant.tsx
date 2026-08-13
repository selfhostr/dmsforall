import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useSession } from '@/hooks/useSession';

/**
 * Préférence de SITE du poste (issue #91 — « le logiciel oublie mon choix dès que je change
 * d'écran », « il me redemande sans arrêt »).
 *
 * NE REMPLACE PAS le mécanisme existant : le site COURANT d'un onglet reste `?site=` dans l'URL
 * (`routes/chemins.ts`, doctrine documentée dans `BarreLaterale.tsx` — deux onglets ouverts sur
 * deux sites différents ne doivent jamais se contredire). Ce module porte une PRÉFÉRENCE, persistée
 * en `localStorage` et namespacée par tenant (un même poste de démo peut servir plusieurs garages) :
 * elle sert à RETROUVER le dernier site choisi quand l'URL courante n'en porte aucun — à
 * l'atterrissage après connexion, ou quand une navigation issue d'un écran qui ne le propage pas
 * a fait perdre le paramètre — jamais à écraser un `?site=` déjà présent dans l'URL.
 *
 * Context plutôt que plusieurs `useState(() => localStorage.getItem(...))` indépendants : `EnTete`,
 * `BarreLaterale` et `OngletsDomaine` sont des composants FRÈRES sous `AppShell` — sans état
 * partagé, choisir un site dans `EnTete` ne se refléterait dans `BarreLaterale` qu'au prochain
 * montage, pas à la navigation suivante dans le MÊME rendu.
 *
 * Valeur PAR DÉFAUT tolérante (jamais de `throw` si le composant est monté hors du fournisseur) :
 * de nombreux composants de la coquille (`BarreLaterale`, `EnTete`, `OngletsDomaine`) ont des specs
 * qui les rendent isolément, sans `AppShell` ni fournisseur — les faire dépendre d'un contexte qui
 * lève casserait ces tests sans rapport avec ce lot. Hors du fournisseur, le comportement dégrade
 * simplement vers « aucune préférence connue », identique au comportement d'avant ce module.
 */
export interface SiteCourant {
  /** `undefined` : aucun site choisi pour l'instant sur ce poste pour ce tenant. */
  readonly preferenceSiteId: string | undefined;
  /** Enregistre `siteId` comme préférence — à appeler au moment où l'utilisateur choisit
   *  EXPLICITEMENT un site précis (jamais pour un choix « tous les sites », qui n'est pas un site
   *  à retenir comme défaut). */
  readonly definirPreferenceSite: (siteId: string) => void;
}

const PREFIXE_CLE_SITE_COURANT = 'dfa.site-courant';

function cleStockage(tenantId: string): string {
  return `${PREFIXE_CLE_SITE_COURANT}.${tenantId}`;
}

function lirePreference(tenantId: string): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return window.localStorage.getItem(cleStockage(tenantId)) ?? undefined;
}

const VALEUR_PAR_DEFAUT: SiteCourant = {
  preferenceSiteId: undefined,
  definirPreferenceSite: () => {},
};

const ContexteSiteCourant = createContext<SiteCourant>(VALEUR_PAR_DEFAUT);

interface Props {
  readonly children: ReactNode;
}

/**
 * Fournisseur — à monter UNE FOIS, au-dessus de tout ce qui doit lire ou écrire la préférence
 * (`AppShell.tsx`, sous chaque route protégée). Lit `useSession()` lui-même (déjà en cache à ce
 * niveau, jamais une requête réseau supplémentaire) plutôt que de recevoir `tenantId` en prop : ça
 * évite à l'appelant de dupliquer cette lecture.
 */
export function FournisseurSiteCourant({ children }: Props) {
  const { data: session } = useSession();
  const tenantId = session?.tenant.id;

  const [preferenceSiteId, setPreferenceSiteId] = useState<string | undefined>(() =>
    tenantId ? lirePreference(tenantId) : undefined,
  );

  // `useSession()` est ASYNCHRONE : `tenantId` vaut `undefined` au tout premier rendu (avant que la
  // session ne soit résolue), donc l'initialiseur `useState` ci-dessus ne lit RIEN dans ce cas — en
  // usage réel `AppShell` ne monte qu'une fois `RouteProtegee` a déjà une session résolue (aucun
  // écart observable), mais le fournisseur peut aussi être monté seul (tests, ou un futur appelant)
  // avant que `tenantId` ne soit connu. Ce re-synchronise dès qu'il apparaît ou change (bascule de
  // tenant dans le même onglet, cas limite mais pas impossible).
  useEffect(() => {
    setPreferenceSiteId(tenantId ? lirePreference(tenantId) : undefined);
  }, [tenantId]);

  const definirPreferenceSite = useCallback(
    (siteId: string) => {
      setPreferenceSiteId(siteId);
      if (tenantId) {
        try {
          window.localStorage.setItem(cleStockage(tenantId), siteId);
        } catch {
          // Quota dépassé ou mode privé restrictif : la préférence reste vraie pour cet onglet
          // (état React déjà mis à jour ci-dessus), simplement pas retrouvée à la prochaine session.
        }
      }
    },
    [tenantId],
  );

  const valeur = useMemo<SiteCourant>(
    () => ({ preferenceSiteId, definirPreferenceSite }),
    [preferenceSiteId, definirPreferenceSite],
  );

  return <ContexteSiteCourant.Provider value={valeur}>{children}</ContexteSiteCourant.Provider>;
}

export function useSiteCourant(): SiteCourant {
  return useContext(ContexteSiteCourant);
}
