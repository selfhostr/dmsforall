import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import { useSession } from '@/hooks/useSession';
import { EcranServiceIndisponible } from '@/ecrans/systeme/EcranServiceIndisponible';
import { EcranVerificationSession } from '@/ecrans/systeme/EcranVerificationSession';

interface Props {
  readonly children: ReactNode;
}

interface EtatNavigation {
  readonly from?: string;
}

/** Miroir de RouteProtegee : mêmes 4 branches, mais une session déjà valide redirige HORS de
 *  la page publique (ex. /login) vers la destination d'origine (`state.from`) ou l'accueil. */
export function RoutePublique({ children }: Props) {
  const { data, isPending, isError } = useSession();
  const location = useLocation();

  if (isPending) return <EcranVerificationSession />;
  if (isError) return <EcranServiceIndisponible />;
  if (data) {
    const etat = location.state as EtatNavigation | null;
    return <Navigate to={etat?.from ?? '/'} replace />;
  }
  return <>{children}</>;
}
