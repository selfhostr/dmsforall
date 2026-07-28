import type { TypeEvenementMetier } from '@dfa/shared';
import type { ContexteTenant, TransactionDfa } from '../../db';

/**
 * Outbox `evenement_metier` (contrats-api-etape-1.md §10, journal des événements métier). Le plan
 * lot 1 tranche EXPLICITEMENT contre le report de cette écriture : « on ne peut pas fabriquer
 * rétroactivement l'historique des événements d'un garage ». L'ÉCRITURE est donc du lot 1 ;
 * l'ÉMISSION HTTP (webhooks signés) ne l'est pas — elle se branche à l'étape 2 sur la même table.
 */
export interface EvenementAPublier {
  readonly type: TypeEvenementMetier;
  /** Version du schéma de `donnees` POUR CE TYPE (§10.3) — commence à 1. */
  readonly versionSchema: number;
  readonly siteId: string | null;
  readonly ressource: {
    readonly type: string;
    readonly id: string;
    /** Numéro métier lisible (n° d'OR, n° de client) quand la ressource en porte un. */
    readonly numero?: string;
  };
  /** Projection stable et additive de la ressource au moment de l'événement. */
  readonly donnees: Readonly<Record<string, unknown>>;
}

export interface ServiceEvenements {
  /**
   * Écrit une ligne d'outbox DANS LA MÊME TRANSACTION `tx` que le changement d'état qui l'a
   * produite — jamais dans une transaction séparée : un événement écrit hors transaction est un
   * événement qui ment (il peut survivre au rollback du changement qu'il prétend décrire, ou
   * l'inverse). L'horodatage `survenuLe` est celui de CETTE écriture (`Horloge`), pas celui d'une
   * éventuelle livraison ultérieure.
   */
  publier(tx: TransactionDfa, ctx: ContexteTenant, evenement: EvenementAPublier): Promise<void>;
}
