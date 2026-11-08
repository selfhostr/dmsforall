import { useQuery } from '@tanstack/react-query';

import type { RoleUtilisateur, VersionSysteme } from '@dfa/shared';

import { clesQuery } from '@/api/cles';
import { recupererVersionSysteme } from '@/api/systeme';

const ROLES_INSTALLATEUR: readonly RoleUtilisateur[] = ['direction', 'admin'];

export function peutInstaller(role: RoleUtilisateur | undefined): boolean {
  return role !== undefined && ROLES_INSTALLATEUR.includes(role);
}

/**
 * Nouvelle version disponible — réservé à ceux qui installent (direction, admin). Le serveur
 * met GitHub en cache 12 h : inutile de réinterroger souvent. Toute erreur = pas d'alerte, jamais
 * un message d'erreur dans le menu.
 */
export function useMiseAJourDisponible(
  role: RoleUtilisateur | undefined,
): VersionSysteme | undefined {
  const { data } = useQuery({
    queryKey: clesQuery.versionSysteme(),
    queryFn: recupererVersionSysteme,
    enabled: peutInstaller(role),
    retry: false,
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  return data?.miseAJourDisponible === true ? data : undefined;
}
