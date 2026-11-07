import { siteUniqueActif } from './ContexteSiteCourant';
import { useSession } from '@/hooks/useSession';

export interface SiteImplicite {
  /** `true` quand le garage n'a qu'un site actif : aucun écran ne doit demander « quel site ? ». */
  readonly estMonoSite: boolean;
  /** Id du site unique, `undefined` si le garage en a plusieurs (ou si la session charge). */
  readonly siteId: string | undefined;
  /** La session est résolue : `estMonoSite === false` est alors fiable (pas un « pas encore »). */
  readonly pret: boolean;
}

/**
 * Site implicite d'un garage mono-site. À utiliser dans tout formulaire qui demande un site :
 * `const { estMonoSite, siteId } = useSiteImplicite();` puis ne pas rendre le champ et envoyer
 * `siteId`. `pret` distingue « plusieurs sites » de « session pas encore chargée ».
 */
export function useSiteImplicite(): SiteImplicite {
  const { data: session } = useSession();
  const siteId = siteUniqueActif(session?.sites);
  return { estMonoSite: siteId !== undefined, siteId, pret: session !== undefined };
}
