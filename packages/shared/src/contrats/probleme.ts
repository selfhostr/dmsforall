/**
 * Contrat d'erreur unique de l'API DFA : `application/problem+json` (RFC 9457) avec un
 * code métier machine stable en plus des champs standard. Le front n'affiche JAMAIS `title`
 * ni `detail` à l'utilisateur — uniquement `code` (traduit via `erreurs:codes.<CODE>`).
 */

export const CODES_ERREUR = [
  'VALIDATION_ECHOUEE',
  'AUTH_IDENTIFIANTS_INVALIDES',
  'AUTH_SESSION_ABSENTE',
  'AUTH_SESSION_EXPIREE',
  'AUTH_COMPTE_SUSPENDU',
  'AUTH_COMPTE_VERROUILLE',
  'AUTH_TENANT_SUSPENDU',
  'AUTH_TROP_DE_TENTATIVES',
  'AUTH_ORIGINE_REFUSEE',
  'DROIT_INSUFFISANT',
  'RESSOURCE_INTROUVABLE',
  'CONFLIT',
  'ERREUR_INTERNE',
] as const;
export type CodeErreur = (typeof CODES_ERREUR)[number];

export interface ErreurChamp {
  readonly champ: string;
  readonly code: string;
  readonly message: string;
}

export interface ProblemeDetail {
  /** `https://docs.dmsforall.example/erreurs/${code}` */
  readonly type: string;
  /** Libellé FR stable, JAMAIS affiché par le front. */
  readonly title: string;
  readonly status: number;
  /** Le contrat machine, seul champ que le front doit lire pour décider quoi afficher. */
  readonly code: CodeErreur;
  readonly detail?: string;
  /** = requeteId, aussi renvoyé en en-tête X-Requete-Id. */
  readonly instance: string;
  readonly erreurs?: ReadonlyArray<ErreurChamp>;
}
