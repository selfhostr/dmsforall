import type { CodeErreur, ErreurChamp } from '@dfa/shared';

/** Statut HTTP associé à chaque code métier — mapping unique et centralisé. */
export const STATUT_PAR_CODE_ERREUR: Readonly<Record<CodeErreur, number>> = {
  VALIDATION_ECHOUEE: 400,
  AUTH_IDENTIFIANTS_INVALIDES: 401,
  AUTH_SESSION_ABSENTE: 401,
  AUTH_SESSION_EXPIREE: 401,
  AUTH_COMPTE_SUSPENDU: 403,
  AUTH_COMPTE_VERROUILLE: 423,
  AUTH_TENANT_SUSPENDU: 403,
  AUTH_TROP_DE_TENTATIVES: 429,
  AUTH_ORIGINE_REFUSEE: 403,
  DROIT_INSUFFISANT: 403,
  RESSOURCE_INTROUVABLE: 404,
  CONFLIT: 409,
  ERREUR_INTERNE: 500,
};

export interface OptionsErreurMetier {
  /** Détail technique complémentaire — jamais affiché à l'utilisateur final par le front. */
  readonly detail?: string;
  readonly erreurs?: ReadonlyArray<ErreurChamp>;
  /** En-têtes additionnels à renvoyer avec la réponse (ex. `Retry-After` sur 429). */
  readonly enTetes?: Readonly<Record<string, string>>;
  /**
   * Override exceptionnel du statut HTTP par défaut du code. N'existe que pour
   * `GET /sante/pret` (§4 endpoint 8) : `CODES_ERREUR` (gelé, packages/shared) ne comporte
   * aucun code dédié "dépendance indisponible", et 503 n'a pas de mapping fixe dans
   * `STATUT_PAR_CODE_ERREUR`. À éviter partout ailleurs — la valeur par défaut du code doit
   * rester la règle.
   */
  readonly status?: number;
}

/**
 * Exception métier typée : toute erreur volontaire remontée par un service (droit
 * insuffisant, ressource introuvable, identifiants invalides…) doit être une `ErreurMetier`,
 * jamais une `HttpException` Nest générique — c'est ce qui garantit un corps
 * `application/problem+json` avec un `code` machine stable, capturé par `FiltreProbleme`.
 */
export class ErreurMetier extends Error {
  readonly code: CodeErreur;
  readonly status: number;
  readonly detail?: string;
  readonly erreurs?: ReadonlyArray<ErreurChamp>;
  readonly enTetes?: Readonly<Record<string, string>>;

  constructor(code: CodeErreur, message: string, options: OptionsErreurMetier = {}) {
    super(message);
    this.name = 'ErreurMetier';
    this.code = code;
    this.status = options.status ?? STATUT_PAR_CODE_ERREUR[code];
    this.detail = options.detail;
    this.erreurs = options.erreurs;
    this.enTetes = options.enTetes;
  }
}
