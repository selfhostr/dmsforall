import { STATUT_HTTP_PAR_CODE_ERREUR, type CodeErreur, type ErreurChamp } from '@dfa/shared';

/**
 * Statut HTTP associé à chaque code métier — ré-export du contrat partagé (gelé,
 * `packages/shared/src/contrats/probleme.ts`). Ne JAMAIS dupliquer cette table ici : c'est
 * elle qui rend impossible, à la compilation, l'ajout d'un code sans statut.
 */
export const STATUT_PAR_CODE_ERREUR = STATUT_HTTP_PAR_CODE_ERREUR;

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
