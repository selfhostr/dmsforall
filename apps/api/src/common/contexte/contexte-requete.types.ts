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
  /**
   * Site auquel le COMPTE est structurellement rattaché (`utilisateur.site_id`, migration 0037),
   * résolu depuis la session à chaque requête — JAMAIS depuis un paramètre de requête, même
   * doctrine que `tenantId` et pour la même raison.
   *
   * Vaut une valeur exactement pour les comptes de service (`ROLES_COMPTE_DE_SERVICE` : la borne
   * d'atelier), `null` pour tout compte de personne, qui n'est restreint à aucun site.
   *
   * OPTIONNEL DANS LE TYPE, TOUJOURS RENSEIGNÉ PAR LE RÉSOLVEUR — arbitrage explicite. Le rendre
   * obligatoire casserait la compilation de la trentaine de principaux construits à la main dans
   * les suites de tests des modules atelier / facturation / pièces / ventes / pointage, tous hors
   * du périmètre d'écriture de ce module. Le risque associé (un consommateur lit `undefined` et
   * conclut « aucune restriction de site ») est neutralisé par le fait qu'AUCUN code ne doit lire
   * ce champ directement : le seul accès sanctionné est `siteImposeAuPrincipal()`
   * (`auth/comptes-de-service.ts`), qui REFUSE (`AUTH_SESSION_EXPIREE`) un compte de service dont
   * le site est absent — fail-closed exactement là où c'est nécessaire.
   * `ServiceSessionImpl.resoudre()` le renseigne systématiquement (test dédié dans
   * `services/session.service.spec.ts`).
   */
  readonly siteId?: string | null;
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
