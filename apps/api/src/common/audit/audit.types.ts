import {
  ACTIONS_AUDITEES,
  ENTITES_AUDITEES,
  type ActionAuditee,
  type EntiteAuditee,
} from '@dfa/shared';

import type { ContexteTenant, TransactionDfa } from '../../db';

/**
 * Miroir TypeScript des enums Postgres `entite_auditee` / `action_auditee`
 * (`db/migrations/0003_prealables_etape1.sql` §3, `entite_auditee` étendu de six valeurs par
 * `0010_facturation.sql` §2). Ce miroir vit dans `@dfa/shared` — pas ici — parce qu'il est
 * exposé tel quel dans un contrat d'API public (`ReponseEntreeJournal.entite`,
 * `contrats/atelier/ordre-reparation.ts`, servi par `GET /ordres-reparation/{id}/journal`) : ce
 * n'est pas un détail de la couche base, c'est un type de contrat. Ce fichier se contente de
 * réexporter `ENTITES_AUDITEES`/`EntiteAuditee` et `ACTIONS_AUDITEES`/`ActionAuditee` pour que
 * les consommateurs de `common/audit` n'aient pas à importer `@dfa/shared` directement ; il ne
 * les redéclare jamais — une redéclaration locale est exactement ce qui avait fait diverger ce
 * fichier (15 valeurs) du contrat partagé (resté à 9) jusqu'à ce que ce commentaire soit corrigé.
 */
export { ACTIONS_AUDITEES, ENTITES_AUDITEES, type ActionAuditee, type EntiteAuditee };

/** Une ligne de `audit_atelier` — écrite par le trigger d'audit générique (posé en migration `0004`, L1-04). */
export interface EntreeAudit {
  readonly id: string;
  readonly entite: EntiteAuditee;
  readonly entiteId: string;
  readonly action: ActionAuditee;
  readonly champ: string | null;
  readonly valeurAvant: unknown;
  readonly valeurApres: unknown;
  readonly utilisateurId: string | null;
  readonly requeteId: string | null;
  readonly creeLe: Date;
}

/**
 * LECTURE SEULE : l'écriture de `audit_atelier` n'appartient pas à cette couche — elle se fait
 * par le trigger générique posé dans chaque migration métier (qui, quoi, quand, avant/après),
 * jamais par un appel applicatif explicite. Ce service sert uniquement les lectures exposées côté
 * API, à commencer par `GET /ordres-reparation/{id}/journal` (L1-12).
 */
export interface ServiceAudit {
  /**
   * Historique complet d'une entité, tri chronologique CROISSANT (ordre du récit).
   *
   * Ouvre SA PROPRE transaction (`AccesBase.enTenant`) — donc sa propre connexion prise sur le
   * pool partagé. Correct pour un appelant qui n'est PAS déjà dans une transaction applicative.
   * Un appelant déjà dans une transaction (`this.acces.enTenant(ctx, async (tx) => ...)`) doit
   * utiliser `pourEntiteTx`/`pourEntitesTx` ci-dessous avec le `tx` qu'il détient déjà — sans
   * quoi la lecture d'audit n'est plus atomique avec le reste de la transaction appelante (elle
   * peut lire un état antérieur ou postérieur au commit de cette dernière), et chaque appel
   * réclame une connexion supplémentaire du pool (`DATABASE_POOL_MAX`).
   */
  pourEntite(
    ctx: ContexteTenant,
    entite: EntiteAuditee,
    entiteId: string,
  ): Promise<readonly EntreeAudit[]>;

  /** Équivalent de `pourEntite`, mais lit DANS la transaction fournie — aucune transaction imbriquée. */
  pourEntiteTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    entite: EntiteAuditee,
    entiteId: string,
  ): Promise<readonly EntreeAudit[]>;

  /**
   * Historique de PLUSIEURS entités en UNE SEULE requête SQL, dans la transaction fournie —
   * remplace une boucle d'appels à `pourEntiteTx`/`pourEntite` (N requêtes, potentiellement N
   * transactions/connexions imbriquées) par un aller-retour unique. Tri chronologique CROISSANT
   * global (toutes entités confondues) ; à l'appelant de refiltrer/retrier par entité si besoin.
   */
  pourEntitesTx(
    tx: TransactionDfa,
    ctx: ContexteTenant,
    entites: readonly { readonly entite: EntiteAuditee; readonly entiteId: string }[],
  ): Promise<readonly EntreeAudit[]>;
}
