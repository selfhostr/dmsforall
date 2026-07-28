import {
  STATUT_HTTP_PAR_CODE_ERREUR,
  type CodeErreur,
  type ErreurChamp,
  type ProblemeDetail,
} from '@dfa/shared';

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
  /**
   * Ce qui bloque, nommément (contrat `ProblemeDetail.blocages`, §3.5 règle 1) — réutilisé tel
   * quel depuis `@dfa/shared`, jamais redéclaré ici. Voir `common/avertissements/` pour la
   * matière brute produite depuis le SQLSTATE `ZDFA1` (transition interdite).
   */
  readonly blocages?: ProblemeDetail['blocages'];
  /** Codes à renvoyer dans `confirmations[]` pour rejouer la requête (§4.4). */
  readonly confirmationsRequises?: ProblemeDetail['confirmationsRequises'];
  /** Le chemin de sortie proposé à l'appelant (§3.3, invariant frontend n°8). */
  readonly actionsProposees?: ProblemeDetail['actionsProposees'];
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
  readonly blocages?: ProblemeDetail['blocages'];
  readonly confirmationsRequises?: ProblemeDetail['confirmationsRequises'];
  readonly actionsProposees?: ProblemeDetail['actionsProposees'];
  readonly enTetes?: Readonly<Record<string, string>>;

  constructor(code: CodeErreur, message: string, options: OptionsErreurMetier = {}) {
    super(message);
    this.name = 'ErreurMetier';
    this.code = code;
    this.status = options.status ?? STATUT_PAR_CODE_ERREUR[code];
    this.detail = options.detail;
    this.erreurs = options.erreurs;
    this.blocages = options.blocages;
    this.confirmationsRequises = options.confirmationsRequises;
    this.actionsProposees = options.actionsProposees;
    this.enTetes = options.enTetes;
  }
}
