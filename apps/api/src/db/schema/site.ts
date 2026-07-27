/**
 * `site` — point de vente / atelier d'un tenant.
 *
 * Une concession en a plusieurs, un garage indépendant un seul. Toute donnée opérationnelle
 * (OR, facture, mouvement de stock) sera rattachée à un site : c'est la maille de reporting et
 * de numérotation des documents.
 */

import { sql } from 'drizzle-orm';
import { boolean, char, check, index, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { colonneId, colonnesHorodatage } from './colonnes-communes';
import { tenant } from './tenant';

export const site = pgTable(
  'site',
  {
    id: colonneId(),

    /**
     * `on delete restrict` : supprimer un tenant qui a encore des sites doit échouer bruyamment.
     * La résiliation passe par `tenant.statut = 'resilie'`, pas par un DELETE en cascade.
     */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'restrict' }),

    /** Code court saisi par le garage (`SION`, `MARTIGNY`) — apparaît dans les n° de documents. */
    code: text('code').notNull(),

    nom: text('nom').notNull(),

    rue: text('rue'),
    /** NPA suisse à 4 chiffres, mais `text` : un site frontalier peut avoir un code étranger. */
    npa: text('npa'),
    localite: text('localite'),
    pays: char('pays', { length: 2 }).notNull().default('CH'),

    /**
     * Désactivation logique. Un site fermé garde tout son historique (OR, factures) : il ne se
     * supprime pas, il se désactive.
     */
    actif: boolean('actif').notNull().default(true),

    ...colonnesHorodatage(),
  },
  (t) => [
    // Le code identifie le site pour les humains à l'intérieur du tenant. Unique par tenant, pas
    // globalement : deux garages peuvent tous deux avoir un site « SION ».
    // Index dérivé utile au-delà de la contrainte : il fournit un préfixe (tenant_id, …) qui
    // sert tous les parcours filtrés par tenant sans tri particulier.
    unique('site_tenant_code_uk').on(t.tenantId, t.code),

    // Cible des futures clés étrangères composites (OR, facture, stock → site).
    // Une FK `(tenant_id, site_id) → site(tenant_id, id)` rend structurellement impossible le
    // rattachement d'un enfant à un site d'un autre tenant : l'étanchéité devient une propriété
    // du schéma, pas une propriété du code applicatif.
    unique('site_tenant_id_uk').on(t.tenantId, t.id),

    // Pagination par curseur de `GET /api/v1/sites`, tri stable (cree_le desc, id desc).
    // Sans cet index, le tri se ferait en mémoire après un scan du préfixe tenant ; c'est
    // indolore sur 3 sites, mais l'index est le patron de pagination que toutes les tables
    // listables du produit vont reprendre — autant l'établir dès la première.
    index('site_tenant_pagination_idx').on(t.tenantId, t.creeLe.desc(), t.id.desc()),

    check('site_code_format_chk', sql`${t.code} ~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'`),
    check('site_nom_non_vide_chk', sql`length(btrim(${t.nom})) > 0`),
    check('site_pays_format_chk', sql`${t.pays} ~ '^[A-Z]{2}$'`),
  ],
);

export type LigneSite = typeof site.$inferSelect;
export type NouveauSite = typeof site.$inferInsert;
