import { useQueries } from '@tanstack/react-query';

import { clesQuery } from '@/api/cles';

import { listerRendezVous } from './rendez-vous.api';

export interface SiteSession {
  readonly id: string;
  readonly nom: string;
}

export interface RendezVousAutreSite {
  readonly siteId: string;
  readonly nom: string;
  /** Rendez-vous non annulés du site sur la période, jour par jour (clé aaaa-mm-jj). */
  readonly parJour: Readonly<Record<string, number>>;
  readonly total: number;
}

/**
 * Combien de rendez-vous existent sur LES AUTRES sites du garage pour la période affichée — un
 * agenda reste scopé à un site (RV-06), donc un rendez-vous pris à Martigny est invisible dans
 * l'agenda de Sion sans cette indication. Une requête par AUTRE site (2-3 sites au plus), même clé
 * de cache que l'agenda de ce site : pas de N+1 sur les rendez-vous. Les annulés ne comptent pas.
 */
export function useRendezVousAutresSites(
  sites: readonly SiteSession[],
  siteCourantId: string | undefined,
  periode: { readonly du: string; readonly au: string },
): readonly RendezVousAutreSite[] {
  const autres = siteCourantId ? sites.filter((s) => s.id !== siteCourantId) : [];
  const resultats = useQueries({
    queries: autres.map((site) => ({
      queryKey: clesQuery.rdv.plage(site.id, periode.du, periode.au),
      queryFn: () => listerRendezVous({ siteId: site.id, du: periode.du, au: periode.au }),
    })),
  });

  return autres.map((site, index) => {
    const parJour: Record<string, number> = {};
    let total = 0;
    for (const rdv of resultats[index]?.data?.donnees ?? []) {
      if (rdv.statut === 'annule') continue;
      parJour[rdv.dateLe] = (parJour[rdv.dateLe] ?? 0) + 1;
      total += 1;
    }
    return { siteId: site.id, nom: site.nom, parJour, total };
  });
}
