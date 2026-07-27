import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import { useSession } from '@/hooks/useSession';
import { EcranServiceIndisponible } from '@/ecrans/systeme/EcranServiceIndisponible';
import { EcranVerificationSession } from '@/ecrans/systeme/EcranVerificationSession';

interface Props {
  readonly children: ReactNode;
}

/** 4 branches strictes (voir contrats-etape-0.md §5) :
 *  1. isPending  -> écran de vérification (identique à RoutePublique, anti-flash)
 *  2. isError    -> service indisponible (JAMAIS l'écran de login)
 *  3. data===null -> redirection /login avec state.from pour revenir après connexion
 *  4. data        -> contenu protégé */
export function RouteProtegee({ children }: Props) {
  const { data, isPending, isError } = useSession();
  const location = useLocation();

  if (isPending) return <EcranVerificationSession />;
  if (isError) return <EcranServiceIndisponible />;
  if (data === null) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}
