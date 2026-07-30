/**
 * Module pièces — `stock_article`, `mouvement_stock`. RP-09→RP-18.
 * Détail des règles et triggers (maintien du physique, verrou de réservation) :
 * migrations/0025_pieces_stock_mouvements.sql.
 */

import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core';

import { colonneCreeLe, colonnesHorodatage } from '../colonnes-communes';
import { site } from '../site';
import { utilisateur } from '../utilisateur';
import { ligneOr } from '../atelier/ordre-reparation';
import { ligneDocument } from '../facturation/document-vente';
import { article } from './article';
import { commandeFournisseurLigne } from './commande-fournisseur';
import { typeMouvementStockEnum } from './enums';

/**
 * Clé naturelle composite (tenant, article, site) — pas de surrogate `id` : aucune autre table
 * n'a besoin de désigner une ligne de stock autrement que par ce triplet (même esprit que
 * `parametre_site`/`parametre_atelier`).
 *
 * `quantiteReserveeMillieme` est maintenue par un trigger posé sur `reservation_piece`
 * (schema/pieces/reservation.ts, migrations/0026) — cette table la POSSÈDE (colonne, contrainte),
 * elle ne la MODIFIE jamais elle-même.
 */
export const stockArticle = pgTable(
  'stock_article',
  {
    tenantId: uuid('tenant_id').notNull(),
    articleId: uuid('article_id').notNull(),
    siteId: uuid('site_id').notNull(),
    quantitePhysiqueMillieme: integer('quantite_physique_millieme').notNull().default(0),
    quantiteReserveeMillieme: integer('quantite_reservee_millieme').notNull().default(0),
    emplacement: text('emplacement'),
    stockMinimumMillieme: integer('stock_minimum_millieme'),
    quantiteCommandeStandardMillieme: integer('quantite_commande_standard_millieme'),
    ...colonnesHorodatage(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.articleId, t.siteId] }),
    foreignKey({
      name: 'stock_article_fk_article',
      columns: [t.tenantId, t.articleId],
      foreignColumns: [article.tenantId, article.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'stock_article_fk_site',
      columns: [t.tenantId, t.siteId],
      foreignColumns: [site.tenantId, site.id],
    }).onDelete('restrict'),
    check('stock_article_reservee_non_negative_chk', sql`${t.quantiteReserveeMillieme} >= 0`),
    // RP-14, filet de dernier recours — la garantie active est le verrou de ligne posé par
    // reservation_piece_verrouiller_stock() (0026), pas ce CHECK seul. Voir son en-tête pour la
    // preuve de concurrence (CP-02).
    check(
      'stock_article_reservee_leq_physique_chk',
      sql`${t.quantiteReserveeMillieme} <= ${t.quantitePhysiqueMillieme}`,
    ),
    check(
      'stock_article_stock_minimum_chk',
      sql`${t.stockMinimumMillieme} is null or ${t.stockMinimumMillieme} >= 0`,
    ),
    check(
      'stock_article_quantite_commande_standard_chk',
      sql`${t.quantiteCommandeStandardMillieme} is null or ${t.quantiteCommandeStandardMillieme} > 0`,
    ),
    index('stock_article_site_idx').on(t.tenantId, t.siteId),
  ],
);

/**
 * IMMUABLE (RP-18) : `dfa_app` n'a ni UPDATE ni DELETE (0025 §4) — une correction est un mouvement
 * INVERSE tracé, jamais une édition. `type` reste `text`-compatible via l'enum extensible
 * `type_mouvement_stock` (RP-16 : « ajouter une valeur ne casse rien qui lise l'enum en
 * s'attendant à une liste fermée »).
 */
export const mouvementStock = pgTable(
  'mouvement_stock',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    articleId: uuid('article_id').notNull(),
    type: typeMouvementStockEnum('type').notNull(),
    /** Signée (RP-17) — SAUF `transfert`, toujours positive (le sens vient des deux sites). */
    quantiteMillieme: integer('quantite_millieme').notNull(),
    siteId: uuid('site_id'),
    siteSourceId: uuid('site_source_id'),
    siteDestinationId: uuid('site_destination_id'),
    prixAchatReelCentimes: integer('prix_achat_reel_centimes'),
    auteurId: uuid('auteur_id'),
    motif: text('motif'),
    ligneOrId: uuid('ligne_or_id'),
    documentVenteLigneId: uuid('document_vente_ligne_id'),
    commandeFournisseurLigneId: uuid('commande_fournisseur_ligne_id'),
    inventaireReferenceId: uuid('inventaire_reference_id'),
    reservationId: uuid('reservation_id'),
    creeLe: colonneCreeLe(),
  },
  (t) => [
    unique('mouvement_stock_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'mouvement_stock_fk_article',
      columns: [t.tenantId, t.articleId],
      foreignColumns: [article.tenantId, article.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'mouvement_stock_fk_site',
      columns: [t.tenantId, t.siteId],
      foreignColumns: [site.tenantId, site.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'mouvement_stock_fk_site_source',
      columns: [t.tenantId, t.siteSourceId],
      foreignColumns: [site.tenantId, site.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'mouvement_stock_fk_site_destination',
      columns: [t.tenantId, t.siteDestinationId],
      foreignColumns: [site.tenantId, site.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'mouvement_stock_fk_ligne_or',
      columns: [t.tenantId, t.ligneOrId],
      foreignColumns: [ligneOr.tenantId, ligneOr.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'mouvement_stock_fk_document_vente_ligne',
      columns: [t.tenantId, t.documentVenteLigneId],
      foreignColumns: [ligneDocument.tenantId, ligneDocument.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'mouvement_stock_fk_commande_fournisseur_ligne',
      columns: [t.tenantId, t.commandeFournisseurLigneId],
      foreignColumns: [commandeFournisseurLigne.tenantId, commandeFournisseurLigne.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'mouvement_stock_fk_auteur',
      columns: [t.tenantId, t.auteurId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),
    check('mouvement_stock_quantite_non_nulle_chk', sql`${t.quantiteMillieme} <> 0`),
    check(
      'mouvement_stock_transfert_signe_chk',
      sql`${t.type} <> 'transfert' or ${t.quantiteMillieme} > 0`,
    ),
    check(
      'mouvement_stock_transfert_sites_chk',
      sql`(${t.type} = 'transfert' and ${t.siteId} is null and ${t.siteSourceId} is not null and ${t.siteDestinationId} is not null and ${t.siteSourceId} <> ${t.siteDestinationId})
          or (${t.type} <> 'transfert' and ${t.siteId} is not null and ${t.siteSourceId} is null and ${t.siteDestinationId} is null)`,
    ),
    check(
      'mouvement_stock_prix_reel_type_chk',
      sql`${t.type} = 'entree_livraison' or ${t.prixAchatReelCentimes} is null`,
    ),
    check(
      'mouvement_stock_prix_reel_signe_chk',
      sql`${t.prixAchatReelCentimes} is null or ${t.prixAchatReelCentimes} >= 0`,
    ),
    check(
      'mouvement_stock_motif_requis_chk',
      sql`${t.type} not in ('casse', 'perte', 'ajustement_inventaire', 'retour_fournisseur', 'retour_client') or ${t.motif} is not null`,
    ),
    index('mouvement_stock_article_idx').on(t.tenantId, t.articleId, t.creeLe.desc()),
    index('mouvement_stock_ligne_or_idx')
      .on(t.tenantId, t.ligneOrId)
      .where(sql`${t.ligneOrId} is not null`),
  ],
);

export type LigneStockArticle = typeof stockArticle.$inferSelect;
export type NouveauStockArticle = typeof stockArticle.$inferInsert;
export type LigneMouvementStock = typeof mouvementStock.$inferSelect;
export type NouveauMouvementStock = typeof mouvementStock.$inferInsert;
