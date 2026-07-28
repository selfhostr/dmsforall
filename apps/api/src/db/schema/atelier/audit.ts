/**
 * `audit_atelier` — piste d'audit générique (RM-59, RM-111), PARTITIONNÉE PAR MOIS.
 *
 * Déclarée ici pour le typage des lectures (`ServiceAuditImpl`, `common/audit/service-audit.ts`,
 * qui lit en SQL brut car cette table n'existait pas encore quand il a été écrit — les noms sont
 * désormais alignés). Drizzle ne modélise pas le partitionnement : `pgTable` suffit à décrire la
 * forme de la table PARENTE, seule interrogée par l'application (jamais une partition nommément
 * — voir migrations/0004_transverse.sql §3, piège B).
 *
 * PAS de `unique (tenant_id, id)` : impossible sur une table partitionnée sans inclure la clé de
 * partition (`cree_le`), et cette table n'est cible d'aucune FK — voir 0004 §2.
 */

import { pgTable, timestamp, uuid, jsonb, text } from 'drizzle-orm/pg-core';

import { entiteAuditeeEnum, actionAuditeeEnum } from './enums';

export const auditAtelier = pgTable('audit_atelier', {
  id: uuid('id').notNull().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  entite: entiteAuditeeEnum('entite').notNull(),
  entiteId: uuid('entite_id').notNull(),
  action: actionAuditeeEnum('action').notNull(),
  champ: text('champ'),
  valeurAvant: jsonb('valeur_avant'),
  valeurApres: jsonb('valeur_apres'),
  utilisateurId: uuid('utilisateur_id'),
  requeteId: text('requete_id'),
  creeLe: timestamp('cree_le', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export type LigneAuditAtelier = typeof auditAtelier.$inferSelect;
export type NouvelleLigneAuditAtelier = typeof auditAtelier.$inferInsert;
