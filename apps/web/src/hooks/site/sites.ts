import type { RoleUtilisateur, SessionCourante } from '@dfa/shared';

/** Id du seul site actif du garage, `undefined` s'il y en a zéro ou plusieurs. */
export function siteUniqueActif(
  sites: ReadonlyArray<{ readonly id: string; readonly actif: boolean }> | undefined,
): string | undefined {
  const actifs = (sites ?? []).filter((site) => site.actif);
  return actifs.length === 1 ? actifs[0]?.id : undefined;
}

/** Valeur du filtre « tous les sites » (jamais un identifiant de site). */
export const TOUS_LES_SITES = 'tous' as const;
export type ChoixSite = string;

const ROLES_VOYANT_TOUS_LES_SITES: readonly RoleUtilisateur[] = ['admin', 'direction', 'comptable'];

/**
 * « Tous les sites » est proposé aux rôles qui pilotent le garage entier : direction,
 * comptabilité, administrateur, patron, et toute personne dont la grille ouvre les finances.
 * Simple confort d'affichage : l'étanchéité reste le tenant côté serveur.
 */
export function peutVoirTousLesSites(session: SessionCourante | null | undefined): boolean {
  if (!session) return false;
  if (ROLES_VOYANT_TOUS_LES_SITES.includes(session.utilisateur.role)) return true;
  const { capacites } = session;
  return capacites.patron || capacites.niveaux.finances !== 'rien';
}

/** Site principal de la personne s'il est encore actif, sinon le site unique du garage. */
export function resoudreSitePrincipal(
  session: Pick<SessionCourante, 'sites' | 'sitePrincipalId'> | null | undefined,
): string | undefined {
  if (!session) return undefined;
  const principal = session.sites.find((s) => s.id === session.sitePrincipalId && s.actif);
  return principal?.id ?? siteUniqueActif(session.sites);
}

export interface EntreeResolutionFiltre {
  readonly sitesActifs: ReadonlyArray<{ readonly id: string }>;
  /** Tous les sites de la session (un lien profond peut viser un site désactivé). */
  readonly tousSitesConnus: ReadonlyArray<{ readonly id: string }>;
  readonly sitePrincipalId: string | undefined;
  readonly tousAutorise: boolean;
  /** `?site=` d'un lien profond. */
  readonly siteUrl: string | undefined;
  /** Dernier choix mémorisé pour cet écran. */
  readonly memorise: string | undefined;
}

/**
 * Site effectif d'un filtre : `undefined` = « Tous ». Précédence : lien profond, choix mémorisé de
 * l'écran, site principal, puis « Tous » si permis, sinon le premier site actif. Un garage à un
 * seul site actif n'a pas de choix : ce site, toujours.
 */
export function resoudreChoixFiltre(e: EntreeResolutionFiltre): string | undefined {
  if (e.sitesActifs.length === 0) return undefined;
  if (e.sitesActifs.length === 1) return e.sitesActifs[0]?.id;
  if (e.siteUrl !== undefined && e.tousSitesConnus.some((s) => s.id === e.siteUrl)) {
    return e.siteUrl;
  }
  if (e.memorise === TOUS_LES_SITES && e.tousAutorise) return undefined;
  if (e.memorise !== undefined && e.sitesActifs.some((s) => s.id === e.memorise)) {
    return e.memorise;
  }
  if (e.sitePrincipalId !== undefined && e.sitesActifs.some((s) => s.id === e.sitePrincipalId)) {
    return e.sitePrincipalId;
  }
  return e.tousAutorise ? undefined : e.sitesActifs[0]?.id;
}
