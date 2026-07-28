import type { ContexteTenant, TransactionDfa } from '../../db';

/**
 * Mécanisme d'idempotence pour les ressources dont le SERVEUR choisit le nom (un numéro d'OR,
 * un numéro de client — RM-11, RM-49) : le client fournit `Idempotency-Key` (`@dfa/shared`,
 * `EN_TETE_IDEMPOTENCE`), l'API mémorise `(statut, corps)` pendant `RETENTION_IDEMPOTENCE_JOURS`.
 *
 * Ne concerne PAS les ressources que le CLIENT nomme (`PUT /x/{id}` avec un id client) : celles-ci
 * sont idempotentes par construction (upsert sur une clé fournie), sans infrastructure
 * supplémentaire — voir le contrat §5, "deux mécanismes selon qui nomme la ressource".
 */

/** Identité d'une commande idempotente : la clé de mémorisation `(tenant, méthode, chemin, cle)`. */
export interface RequeteIdempotente {
  /** Méthode HTTP en majuscules (`POST`). */
  readonly methode: string;
  /** PATRON de route (ex. `/clients`), jamais l'URL résolue — même convention que FiltreProbleme. */
  readonly chemin: string;
  /** Valeur de l'en-tête `Idempotency-Key`, un uuid v4 (`schemaCleIdempotence`, `@dfa/shared`). */
  readonly cle: string;
  /** Corps de la requête, canonicalisé en interne pour calculer l'empreinte (SHA-256). */
  readonly corps: unknown;
}

/** Ce qu'un appel idempotent produit et que `ServiceIdempotence` a le droit de rejouer plus tard. */
export interface ReponseMemorisable {
  readonly statutHttp: number;
  readonly corps: unknown;
}

export interface ResultatIdempotent<T extends ReponseMemorisable> {
  readonly reponse: T;
  /** `true` si `reponse` est le REJEU d'une exécution antérieure (poser `Idempotency-Rejeu: true`). */
  readonly rejoue: boolean;
}

export interface ServiceIdempotence {
  /**
   * Exécute `travail` sous garantie d'idempotence pour `requete.cle`, scopée à
   * `(tenant, méthode, chemin, clé)`. Ouvre SA PROPRE transaction (`AccesBase.enTenant`) : la
   * mémorisation de la réponse et le travail métier (numérotation comprise) commitent ou
   * annulent ensemble — un rejeu ne peut donc jamais voir un numéro brûlé par un travail qui a
   * finalement échoué.
   *
   * Sémantique (contrats-api-etape-1.md §5) :
   *  - clé inconnue → exécute `travail`, mémorise `(statutHttp, corps)`, `rejoue: false` ;
   *  - clé connue + même empreinte de corps + statut `termine` → rejeu à l'identique, `rejoue: true` ;
   *  - clé connue + empreinte différente → `409 IDEMPOTENCE_CONFLIT` ;
   *  - clé connue + exécution initiale encore `en_cours` → `409 IDEMPOTENCE_CONFLIT` +
   *    `Retry-After: 1`.
   */
  executer<T extends ReponseMemorisable>(
    ctx: ContexteTenant,
    requete: RequeteIdempotente,
    travail: (tx: TransactionDfa) => Promise<T>,
  ): Promise<ResultatIdempotent<T>>;
}
