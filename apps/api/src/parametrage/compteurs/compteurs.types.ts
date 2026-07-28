import type { TransactionDfa } from '../../db';

/**
 * Clé d'un compteur : `(tenant_id, type_document, annee, site_id)` — exactement les colonnes de
 * l'index d'unicité `compteur_document_uk` (`site_id` `coalesce`é à un uuid nul dans l'index,
 * `null` ici étant la portée « tenant » au sens de P-01 / `parametre_atelier.or_portee_numerotation`).
 *
 * `typeDocument` et `annee` sont laissés au choix de l'appelant : ce service ne connaît AUCUNE
 * règle de formatage (`OR-2026-1042`, `C-004128`…) ni AUCUNE politique métier (préfixe, portée
 * tenant/site, remise à zéro annuelle) — ces règles appartiennent au module qui émet le document
 * (atelier pour l'OR, lit `parametre_atelier.or_prefixe` / `or_portee_numerotation` /
 * `or_reset_annuel` ; clients pour le numéro de client). `ServiceCompteurs` fournit uniquement la
 * primitive atomique et rejouable-sans-trou sur laquelle ces politiques se construisent.
 */
export interface ClefCompteur {
  readonly tenantId: string;
  readonly typeDocument: string;
  readonly annee: number;
  readonly siteId: string | null;
}

/**
 * Numérotation continue par tenant/année/[site] — `compteur_document`
 * (`db/migrations/0005_parametrage.sql` §4), volontairement PAS une SEQUENCE PostgreSQL.
 *
 * Contrat de continuité (RM-49, RM-11, `plan-lot1-execution.md` §L1-07 « Done ») : appelé
 * DANS la transaction du document en cours de création (le même `tx` que le reste de la
 * commande, y compris `ServiceIdempotence.executer` le cas échéant) — un `INSERT`/`UPDATE`
 * ordinaire est annulé par un `ROLLBACK` comme n'importe quelle autre écriture de la
 * transaction : **aucun trou n'est possible**, contrairement à une `SEQUENCE` PostgreSQL qui
 * n'est jamais annulée par un rollback.
 *
 * Le rôle du numéro (id lisible par l'humain, ex. `OR-2026-1042` ou `C-004128`) n'appartient PAS
 * à ce service : il rend un entier brut, strictement croissant par clé, jamais réutilisé.
 */
export interface ServiceCompteurs {
  /**
   * Incrémente et rend le prochain numéro pour la clé donnée. Crée la ligne de compteur au
   * premier appel (valeur initiale 1). Doit être appelé sur un `tx` déjà ouvert via
   * `AccesBase.enTenant` — ce service n'ouvre jamais sa propre transaction.
   */
  prochainNumero(tx: TransactionDfa, clef: ClefCompteur): Promise<number>;
}
