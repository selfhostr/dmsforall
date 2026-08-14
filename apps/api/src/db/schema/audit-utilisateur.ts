/**
 * `audit_utilisateur` — piste d'audit APPEND-ONLY dédiée à la gestion des comptes employés
 * (migration 0054, issue #137) : création, changement de rôle, changement de sites,
 * désactivation/réactivation, réinitialisation d'accès. Distincte de `journal_securite`
 * (événements d'authentification, enum partagé racine `@dfa/shared`, hors périmètre d'écriture
 * de cette tâche) et de `audit_atelier` (domaine atelier, propriété d'un autre agent).
 *
 * Ne contient JAMAIS de mot de passe ni de hash — `reinitialiser-acces` y écrit une ligne sans
 * `avant`/`apres` : seul le fait que le geste a eu lieu (qui, quand, sur qui) compte.
 */

import { pgEnum, pgTable, jsonb, uuid, foreignKey, index } from 'drizzle-orm/pg-core';

import { colonneId, colonneCreeLe, colonneTenantId } from './colonnes-communes';
import { utilisateur } from './utilisateur';

export const ACTIONS_AUDIT_UTILISATEUR = [
  'creation',
  'modification_role',
  'modification_sites',
  'desactivation',
  'reactivation',
  'reinitialisation_acces',
] as const;
export type ActionAuditUtilisateur = (typeof ACTIONS_AUDIT_UTILISATEUR)[number];

export const actionAuditUtilisateurEnum = pgEnum(
  'action_audit_utilisateur',
  ACTIONS_AUDIT_UTILISATEUR,
);

export const auditUtilisateur = pgTable(
  'audit_utilisateur',
  {
    id: colonneId(),
    tenantId: colonneTenantId(),
    utilisateurCibleId: uuid('utilisateur_cible_id').notNull(),
    actionParId: uuid('action_par_id').notNull(),
    action: actionAuditUtilisateurEnum('action').notNull(),
    avant: jsonb('avant').$type<Record<string, unknown>>(),
    apres: jsonb('apres').$type<Record<string, unknown>>(),
    creeLe: colonneCreeLe(),
  },
  (t) => [
    foreignKey({
      name: 'audit_utilisateur_fk_cible',
      columns: [t.tenantId, t.utilisateurCibleId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'audit_utilisateur_fk_acteur',
      columns: [t.tenantId, t.actionParId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),
    index('audit_utilisateur_cible_idx').on(t.tenantId, t.utilisateurCibleId, t.creeLe),
  ],
);

export type LigneAuditUtilisateur = typeof auditUtilisateur.$inferSelect;
export type NouvelleLigneAuditUtilisateur = typeof auditUtilisateur.$inferInsert;
