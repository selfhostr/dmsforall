import { useSession } from '@/hooks/useSession';

import { resoudreSitePrincipal } from './sites';

/** Site principal de la personne connectée (défaut des créations et des filtres), si connu. */
export function useSitePrincipal(): string | undefined {
  const { data: session } = useSession();
  return resoudreSitePrincipal(session);
}
