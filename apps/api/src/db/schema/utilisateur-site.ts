/**
 * `utilisateur_site` — affectation N:N employé ↔ site, PUREMENT DESCRIPTIVE (migration 0054,
 * issue #137). Sert l'affichage (« sur quels sites travaille cet employé ? ») et le planning —
 * RIEN D'AUTRE. Le rôle d'un utilisateur reste unique et vaut sur TOUT le tenant
 * (`utilisateur.role`, `auth/matrice-droits.ts`) : aucune action de la matrice des droits n'est
 * scopée par site, et cette table ne doit JAMAIS le devenir. Voir le commentaire de la migration
 * 0054 pour l'arbitrage complet (variante « rôle par site » explicitement écartée).
 */

import { pgTable, uuid, foreignKey, unique } from 'drizzle-orm/pg-core';

import { colonneId, colonneCreeLe, colonneTenantId } from './colonnes-communes';
import { site } from './site';
import { utilisateur } from './utilisateur';

export const utilisateurSite = pgTable(
  'utilisateur_site',
  {
    id: colonneId(),
    tenantId: colonneTenantId(),
    utilisateurId: uuid('utilisateur_id').notNull(),
    siteId: uuid('site_id').notNull(),
    creeLe: colonneCreeLe(),
  },
  (t) => [
    unique('utilisateur_site_tenant_utilisateur_site_uk').on(t.tenantId, t.utilisateurId, t.siteId),
    foreignKey({
      name: 'utilisateur_site_fk_utilisateur',
      columns: [t.tenantId, t.utilisateurId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'utilisateur_site_fk_site',
      columns: [t.tenantId, t.siteId],
      foreignColumns: [site.tenantId, site.id],
    }).onDelete('cascade'),
  ],
);

export type LigneUtilisateurSite = typeof utilisateurSite.$inferSelect;
export type NouvelleLigneUtilisateurSite = typeof utilisateurSite.$inferInsert;
