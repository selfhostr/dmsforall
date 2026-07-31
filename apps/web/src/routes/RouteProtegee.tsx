import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import type { RoleUtilisateur } from '@dfa/shared';

import { useSession } from '@/hooks/useSession';
import { EcranServiceIndisponible } from '@/ecrans/systeme/EcranServiceIndisponible';
import { EcranVerificationSession } from '@/ecrans/systeme/EcranVerificationSession';

import { EcranAccesRefuse } from './EcranAccesRefuse';

interface Props {
  readonly children: ReactNode;
  /**
   * Restreint la route à un sous-ensemble de rôles — calqué LITTÉRALEMENT sur le(s) droit(s)
   * que l'API exige pour l'action portée par l'écran (voir `apps/api/src/auth/matrice-droits.ts`,
   * ex. `parametrage.referentiel.modifier` -> `chef_atelier`/`direction`/`admin`). Omis : tout
   * utilisateur authentifié passe, comportement historique inchangé pour les routes qui ne
   * portent aucune restriction propre au rôle (l'API reste de toute façon l'arbitre final à
   * chaque appel — ceci évite seulement d'afficher un écran que l'utilisateur ne pourra pas
   * utiliser). Poser cette prop est le pendant réel, côté route, du masquage d'une entrée dans
   * `BarreLaterale` : masquer dans le menu SEUL ne protège rien, un utilisateur qui connaît
   * l'URL l'atteindrait quand même sans ce contrôle.
   */
  readonly rolesAutorises?: readonly RoleUtilisateur[];
}

/** 5 branches strictes (les 4 historiques de contrats-etape-0.md §5, plus la restriction par
 *  rôle ajoutée au lot 2) :
 *  1. isPending    -> écran de vérification (identique à RoutePublique, anti-flash)
 *  2. isError      -> service indisponible (JAMAIS l'écran de login)
 *  3. data===null  -> redirection /login avec state.from pour revenir après connexion
 *  4. rôle refusé  -> écran d'accès refusé (JAMAIS le contenu, JAMAIS une redirection muette)
 *  5. data + rôle OK -> contenu protégé */
export function RouteProtegee({ children, rolesAutorises }: Props) {
  const { data, isPending, isError } = useSession();
  const location = useLocation();

  if (isPending) return <EcranVerificationSession />;
  if (isError) return <EcranServiceIndisponible />;
  if (data === null) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (rolesAutorises && !rolesAutorises.includes(data.utilisateur.role)) {
    return <EcranAccesRefuse />;
  }
  return <>{children}</>;
}
