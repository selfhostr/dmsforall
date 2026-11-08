import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { useSession } from '@/hooks/useSession';

import {
  peutVoirTousLesSites,
  resoudreChoixFiltre,
  resoudreSitePrincipal,
  TOUS_LES_SITES,
} from './sites';

export interface SiteFiltrable {
  readonly id: string;
  readonly code: string;
  readonly codeCourt: string;
  readonly nom: string;
}

export interface FiltreSite {
  /** Faux avec un seul site actif : le filtre ne s'affiche pas. */
  readonly visible: boolean;
  readonly sites: readonly SiteFiltrable[];
  /** Site filtré, `undefined` = tous les sites (ou session pas encore chargée). */
  readonly siteId: string | undefined;
  readonly tousPropose: boolean;
  readonly choisir: (siteId: string | undefined) => void;
  /** La session est résolue : `siteId === undefined` est alors un vrai « tous ». */
  readonly pret: boolean;
}

interface Options {
  /** Écran qui exige un site précis (stock, caisse) : jamais d'option « Tous ». */
  readonly siteObligatoire?: boolean;
}

function cle(tenantId: string, utilisateurId: string, ecran: string): string {
  return `dfa.filtre-site.${tenantId}.${utilisateurId}.${ecran}`;
}

function lire(k: string): string | undefined {
  try {
    return window.localStorage.getItem(k) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Filtre de site LOCAL à un écran (aucun contexte global). `ecran` nomme la mémoire du choix
 * (`localStorage`, par tenant + personne + écran). Défaut : site principal de la personne ;
 * « Tous » pour les rôles qui pilotent plusieurs sites, sauf `siteObligatoire`.
 */
export function useFiltreSite(ecran: string, options: Options = {}): FiltreSite {
  const { data: session } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const tenantId = session?.tenant.id ?? '';
  const utilisateurId = session?.utilisateur.id ?? '';
  const stockage = cle(tenantId, utilisateurId, ecran);
  const [choisi, setChoisi] = useState<{ cle: string; valeur: string } | undefined>(undefined);

  const sites = useMemo(() => (session?.sites ?? []).filter((s) => s.actif), [session?.sites]);
  const tousAutorise = !options.siteObligatoire && peutVoirTousLesSites(session);
  const memorise = choisi?.cle === stockage ? choisi.valeur : lire(stockage);

  const pret = session !== undefined && session !== null;
  const siteUrl = searchParams.get('site') ?? undefined;

  const siteResolu = resoudreChoixFiltre({
    sitesActifs: sites,
    tousSitesConnus: session?.sites ?? [],
    sitePrincipalId: resoudreSitePrincipal(session),
    tousAutorise,
    siteUrl,
    memorise,
  });
  // Session pas encore résolue : un lien profond `?site=` sert tel quel (comportement d'avant le
  // filtre), le reste attend — jamais un site deviné.
  const siteId = pret ? siteResolu : siteUrl;

  const choisir = useCallback(
    (nouveau: string | undefined) => {
      const valeur = nouveau ?? TOUS_LES_SITES;
      setChoisi({ cle: stockage, valeur });
      try {
        window.localStorage.setItem(stockage, valeur);
      } catch {
        // Stockage refusé : le choix reste valable pour cet affichage.
      }
      // Un lien profond `?site=` ne doit pas contredire le choix qui vient d'être fait.
      if (searchParams.has('site')) {
        const suivants = new URLSearchParams(searchParams);
        suivants.delete('site');
        setSearchParams(suivants, { replace: true });
      }
    },
    [stockage, searchParams, setSearchParams],
  );

  return {
    visible: sites.length > 1,
    sites,
    siteId,
    tousPropose: tousAutorise,
    choisir,
    pret,
  };
}
