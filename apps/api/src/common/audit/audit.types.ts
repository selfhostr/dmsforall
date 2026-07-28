import type { ContexteTenant } from '../../db';

/**
 * Miroir TypeScript des enums Postgres `entite_auditee` / `action_auditee`
 * (`db/migrations/0003_prealables_etape1.sql` §3) — pas de type partagé pour ceux-ci dans
 * `@dfa/shared` (ce sont des enums de la COUCHE BASE, pas un contrat d'API), donc déclarés
 * localement, à l'identique et dans le même ordre que la migration. Toute divergence future entre
 * ce fichier et la migration est une dérive à corriger ICI, jamais en base : la migration fait foi.
 */
export const ENTITES_AUDITEES = [
  'ordre_reparation',
  'ligne_or',
  'devis_complementaire',
  'pointage',
  'vehicule_detention',
  'vehicule_kilometrage',
  'client',
  'rendez_vous',
  'pret_courtoisie',
] as const;
export type EntiteAuditee = (typeof ENTITES_AUDITEES)[number];

export const ACTIONS_AUDITEES = ['creation', 'modification', 'transition', 'annulation', 'fusion'] as const;
export type ActionAuditee = (typeof ACTIONS_AUDITEES)[number];

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
  /** Historique complet d'une entité, tri chronologique CROISSANT (ordre du récit). */
  pourEntite(ctx: ContexteTenant, entite: EntiteAuditee, entiteId: string): Promise<readonly EntreeAudit[]>;
}
