import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import type { RoleUtilisateur } from '@dfa/shared';

import { cheminDansModuleRetire } from '@/composants/layout/navigation-modele';
import { peutUne } from '@/droits';
import { useSession } from '@/hooks/useSession';
import { EcranServiceIndisponible } from '@/ecrans/systeme/EcranServiceIndisponible';
import { EcranVerificationSession } from '@/ecrans/systeme/EcranVerificationSession';

import { EcranAccesRefuse } from './EcranAccesRefuse';
import type { DestinationAtterrissage } from './atterrissage';
import { chemins } from './chemins';
import type { Acces } from './droits-routes';

/** `/` (le relais d'atterrissage la renvoie vers la borne) et l'écran de la borne seulement. */
function cheminAutoriseALaBorne(pathname: string): boolean {
  const borne = chemins.pointage.borne();
  return pathname === '/' || pathname === borne || pathname.startsWith(`${borne}/`);
}

interface Props {
  readonly children: ReactNode;
  /**
   * Restreint la route aux personnes qui détiennent AU MOINS UNE de ces actions (`session.actions`,
   * voir `@/droits` et `routes/droits-routes.ts`) — le droit que l'API exige pour l'écran. Omis : tout
   * utilisateur authentifié passe, comportement historique inchangé pour les routes qui ne
   * portent aucune restriction propre au rôle (l'API reste de toute façon l'arbitre final à
   * chaque appel — ceci évite seulement d'afficher un écran que l'utilisateur ne pourra pas
   * utiliser). Poser cette prop est le pendant réel, côté route, du masquage d'une entrée dans
   * `BarreLaterale` : masquer dans le menu SEUL ne protège rien, un utilisateur qui connaît
   * l'URL l'atteindrait quand même sans ce contrôle.
   */
  readonly accesAutorise?: Acces;
  /**
   * Redirection automatique par rôle, appliquée APRÈS la vérification de rôle mais AVANT le rendu
   * de `children` — mécanisme distinct de `accesAutorise` : ce n'est pas une restriction (le
   * rôle qui matche ne perd aucun droit, il ne voit simplement pas CET écran-ci), c'est un choix
   * d'atterrissage. Introduit pour le Lot 0 de la refonte de navigation
   * (`docs/plan-refonte-navigation.md`, section « Lot 0 — Dettes préalables ») : le rôle
   * `poste_atelier` (borne murale partagée, compte de service sans personne physique derrière)
   * doit atterrir sur `/pointage/borne` plutôt que sur l'accueil générique — jusqu'ici la borne
   * n'était atteignable qu'en tapant l'URL à la main (aucun `NavLink` vers elle dans
   * `BarreLaterale.tsx`, aucune redirection ici), ce qui la rendait inatteignable en usage réel.
   * Posé sur la route index (`routeur.tsx`) pour l'instant ; rien n'empêche de le poser sur une
   * autre route protégée si un besoin similaire apparaît.
   */
  readonly redirectionParRole?: Partial<Record<RoleUtilisateur, string | DestinationAtterrissage>>;
}

/** 6 branches strictes (les 4 historiques de contrats-etape-0.md §5, la restriction par rôle
 *  ajoutée au lot 2, et la redirection par rôle ajoutée au Lot 0 de la refonte de navigation) :
 *  1. isPending                  -> écran de vérification (identique à RoutePublique, anti-flash)
 *  2. isError SANS session connue -> service indisponible (JAMAIS l'écran de login)
 *  3. data===null                -> redirection /login avec state.from pour revenir après connexion
 *  4. rôle refusé                -> écran d'accès refusé (JAMAIS le contenu, JAMAIS une redirection muette)
 *  5. redirection posée pour ce rôle -> `<Navigate>` vers la destination dédiée (ex.
 *     `poste_atelier` -> `/pointage/borne`), AVANT le rendu de `children` : ce n'est pas un refus,
 *     l'utilisateur a bien le droit d'être ici, on choisit juste de ne pas lui montrer CET écran
 *  6. data + rôle OK + aucune redirection posée -> contenu protégé
 *
 *  CORRECTIF issue #77 (perte de saisie) : la branche 2 ne se déclenche plus sur UNE ERREUR
 *  D'ARRIÈRE-PLAN quand une session est DÉJÀ CONNUE. `useSession()` a `staleTime: 5 * 60 * 1000`
 *  et `refetchOnWindowFocus: true` (`hooks/useSession.ts`) : un simple retour d'onglet après une
 *  coupure réseau passagère, ou n'importe quel refetch qui échoue une fois, faisait basculer
 *  `isError` à `true` — et cette route étant celle qui enveloppe `<AppShell/>` (donc tout écran
 *  routé, y compris un formulaire en cours de saisie), ce basculement DÉMONTAIT l'intégralité de
 *  l'arbre protégé pour le remplacer par `EcranServiceIndisponible`. Cliquer « Réessayer » ne
 *  faisait alors que confirmer la perte : même en cas de succès, `AppShell` et tout ce qui vivait
 *  dessous remontaient de zéro. TanStack Query NE VIDE PAS `data` sur un échec d'arrière-plan
 *  (`query-core`, réducteur `case 'error'` : seuls `status`/`error` changent, `data` reste
 *  l'ancienne valeur connue — vérifié dans le code source de la dépendance) : `data` reste donc la
 *  DERNIÈRE session valide tant qu'aucun chargement initial n'a échoué. Seul un échec du TOUT
 *  PREMIER chargement (`data === undefined`, aucune session jamais connue) justifie encore l'écran
 *  de service indisponible — dans ce cas précis, et seulement celui-là, on ignore réellement l'état
 *  d'authentification. */
export function RouteProtegee({ children, accesAutorise, redirectionParRole }: Props) {
  const { data, isPending, isError } = useSession();
  const location = useLocation();

  if (isPending) return <EcranVerificationSession />;
  if (isError && data === undefined) return <EcranServiceIndisponible />;
  if (data === undefined) {
    // Inatteignable en pratique (isPending/isError couvrent déjà tout état sans session connue),
    // mais on refuse de rendre `children` sans donnée plutôt que de deviner un état.
    return <EcranServiceIndisponible />;
  }
  if (data === null) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  // Borne murale (`poste_atelier`) : un appareil, pas un employé. Son profil API lit les OR (pour
  // le pointage) mais l'interface ne lui ouvre QUE l'écran de la borne — jamais la liste des OR ni
  // une page qui partirait en 403 (factures, clients…).
  if (data.utilisateur.role === 'poste_atelier' && !cheminAutoriseALaBorne(location.pathname)) {
    return <Navigate to={chemins.pointage.borne()} replace />;
  }
  if (accesAutorise && !peutUne(data.actions, ...accesAutorise)) {
    return <EcranAccesRefuse />;
  }
  // Module retiré par le garage (Réglages > Modules) : la route n'existe plus pour personne. Le
  // module d'une URL vient du modèle de navigation — un seul endroit, aucune route à annoter.
  if (cheminDansModuleRetire(location.pathname, data.modulesActifs)) {
    return <Navigate to="/" replace />;
  }
  const brute = redirectionParRole?.[data.utilisateur.role];
  const destinationRedirection =
    typeof brute === 'object' && !peutUne(data.actions, ...brute.acces)
      ? undefined
      : typeof brute === 'object'
        ? brute.chemin
        : brute;
  // Un atterrissage vers un module retiré (ex. la borne quand les tablettes le sont) ne redirige
  // pas : l'accueil s'affiche, sans boucle `/` -> destination -> `/`.
  if (
    destinationRedirection &&
    !cheminDansModuleRetire(destinationRedirection.split('?')[0] ?? '', data.modulesActifs)
  ) {
    return <Navigate to={destinationRedirection} replace />;
  }
  return <>{children}</>;
}
