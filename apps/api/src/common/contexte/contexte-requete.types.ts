import type { Langue, RoleUtilisateur } from '@dfa/shared';

/**
 * Principal attaché à la requête une fois la session résolue par `GardeSession`
 * (apps/api/src/auth/). Absent tant que la garde n'a pas tourné (route publique, ou
 * requête pas encore authentifiée) — voir `ServiceContexteRequete.exigerPrincipal`.
 */
export interface PrincipalAuthentifie {
  readonly sessionId: string;
  readonly tenantId: string;
  readonly utilisateurId: string;
  readonly role: RoleUtilisateur;
  readonly langue: Langue;
}

export interface ContexteRequete {
  /** uuid v4, renvoyé en en-tête X-Requete-Id. */
  readonly requeteId: string;
  readonly debutLe: Date;
  readonly ip: string | null;
  readonly userAgent: string | null;
  /** Accept-Language négocié, défaut 'fr'. */
  readonly langue: Langue;
  readonly principal: PrincipalAuthentifie | null;
}
