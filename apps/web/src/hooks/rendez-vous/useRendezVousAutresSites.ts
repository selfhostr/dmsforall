import { useQuery } from '@tanstack/react-query';

import { clesQuery } from '@/api/cles';

import { resumerRendezVousParSite } from './rendez-vous.api';

export interface SiteSession {
  readonly id: string;
  readonly nom: string;
}

export interface RendezVousAutreSite {
  readonly siteId: string;
  readonly nom: string;
  /** Rendez-vous non annulés du site sur la période. */
  readonly total: number;
}

/**
 * Combien de rendez-vous existent sur LES AUTRES sites du garage pour la période affichée — un
 * agenda reste scopé à un site (RV-06), donc un rendez-vous pris à Martigny est invisible dans
 * l'agenda de Sion sans cette indication. UN appel `GET /rendez-vous/resume-sites?du&au` pour tous
 * les sites (le serveur exclut les rendez-vous annulés). Le nom du site vient de la session.
 */
export function useRendezVousAutresSites(
  sites: readonly SiteSession[],
  siteCourantId: string | undefined,
  periode: { readonly du: string; readonly au: string },
): readonly RendezVousAutreSite[] {
  const autres = siteCourantId ? sites.filter((s) => s.id !== siteCourantId) : [];
  const requete = useQuery({
    queryKey: clesQuery.rdv.resumeSites(periode.du, periode.au),
    queryFn: () => resumerRendezVousParSite(periode.du, periode.au),
    enabled: autres.length > 0,
  });

  const nombreParSite = new Map((requete.data ?? []).map((r) => [r.siteId, r.nombre]));
  return autres.map((site) => ({
    siteId: site.id,
    nom: site.nom,
    total: nombreParSite.get(site.id) ?? 0,
  }));
}
