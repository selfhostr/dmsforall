import { useEffect, useRef } from 'react';

import { useSiteImplicite } from './useSiteImplicite';

/**
 * Pour un sélecteur de site de repli : en garage mono-site, le site est choisi d'office (une seule
 * fois) et le sélecteur n'a rien à demander. Renvoie `true` tant que ce choix implicite s'applique,
 * pour que le sélecteur affiche un état de chargement plutôt qu'une question sans objet.
 */
export function useChoisirSiteImplicite(onChoisir: (siteId: string) => void): boolean {
  const { estMonoSite, siteId } = useSiteImplicite();
  const dejaChoisi = useRef(false);
  useEffect(() => {
    if (estMonoSite && siteId && !dejaChoisi.current) {
      dejaChoisi.current = true;
      onChoisir(siteId);
    }
  }, [estMonoSite, siteId, onChoisir]);
  return estMonoSite;
}
