import type { ReactNode } from 'react';
import { Navigate } from 'react-router';

import { EcranVerificationSession } from '@/ecrans/systeme/EcranVerificationSession';
import { useEtatInstallation } from '@/hooks/useEtatInstallation';

export const CHEMIN_INSTALLATION = '/installation';

/** Garde de `/login` : sur une instance sans garage, la connexion n'a aucun sens — on envoie vers
 *  la création. Si l'état est illisible (réseau, serveur), on garde la connexion : jamais
 *  d'écran de création sur un doute. */
export function RedirectionVersInstallation({ children }: { readonly children: ReactNode }) {
  const { data, isPending } = useEtatInstallation();
  if (isPending) return <EcranVerificationSession />;
  if (data?.premierGarageRequis === true) return <Navigate to={CHEMIN_INSTALLATION} replace />;
  return <>{children}</>;
}

/** Garde de `/installation` : seulement tant que l'instance attend son premier garage. Sinon (ou
 *  au moindre doute), retour à la connexion. */
export function GardeInstallation({ children }: { readonly children: ReactNode }) {
  const { data, isPending } = useEtatInstallation();
  if (isPending) return <EcranVerificationSession />;
  if (data?.premierGarageRequis !== true) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
