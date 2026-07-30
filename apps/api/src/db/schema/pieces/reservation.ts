/**
 * Module pièces — `reservation_piece`. LE CŒUR DU SUJET (RP-19→RP-25, §6.3, CP-02).
 * Détail des règles et triggers (verrou de ligne sur stock_article, garantie de concurrence) :
 * migrations/0026_pieces_reservation.sql.
 */

import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { colonneCreeLe } from '../colonnes-communes';
import { utilisateur } from '../utilisateur';
import { ligneOr, ordreReparation } from '../atelier/ordre-reparation';
import { mouvementStock, stockArticle } from './stock';
import { motifLiberationReservationEnum, statutReservationPieceEnum } from './enums';

export const reservationPiece = pgTable(
  'reservation_piece',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    articleId: uuid('article_id').notNull(),
    siteId: uuid('site_id').notNull(),
    ligneOrId: uuid('ligne_or_id').notNull(),
    ordreReparationId: uuid('ordre_reparation_id').notNull(),
    quantiteMillieme: integer('quantite_millieme').notNull(),
    statut: statutReservationPieceEnum('statut').notNull().default('active'),
    creeLe: colonneCreeLe(),
    satisfaiteLe: timestamp('satisfaite_le', { withTimezone: true, mode: 'date' }),
    mouvementSortieId: uuid('mouvement_sortie_id'),
    libereeLe: timestamp('liberee_le', { withTimezone: true, mode: 'date' }),
    motifLiberation: motifLiberationReservationEnum('motif_liberation'),
    motifLiberationTexte: text('motif_liberation_texte'),
    libereeParUtilisateurId: uuid('liberee_par_utilisateur_id'),
  },
  (t) => [
    unique('reservation_piece_tenant_id_uk').on(t.tenantId, t.id),
    // RP-19 : une ligne d'OR pièce produit au plus une réservation.
    unique('reservation_piece_tenant_ligne_or_uk').on(t.tenantId, t.ligneOrId),
    foreignKey({
      name: 'reservation_piece_fk_stock',
      columns: [t.tenantId, t.articleId, t.siteId],
      foreignColumns: [stockArticle.tenantId, stockArticle.articleId, stockArticle.siteId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'reservation_piece_fk_ligne_or',
      columns: [t.tenantId, t.ligneOrId],
      foreignColumns: [ligneOr.tenantId, ligneOr.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'reservation_piece_fk_ordre_reparation',
      columns: [t.tenantId, t.ordreReparationId],
      foreignColumns: [ordreReparation.tenantId, ordreReparation.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'reservation_piece_fk_mouvement_sortie',
      columns: [t.tenantId, t.mouvementSortieId],
      foreignColumns: [mouvementStock.tenantId, mouvementStock.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'reservation_piece_fk_liberee_par',
      columns: [t.tenantId, t.libereeParUtilisateurId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),
    check('reservation_piece_quantite_chk', sql`${t.quantiteMillieme} > 0`),
    check(
      'reservation_piece_active_coherente_chk',
      sql`${t.statut} <> 'active' or (${t.satisfaiteLe} is null and ${t.mouvementSortieId} is null and ${t.libereeLe} is null and ${t.motifLiberation} is null and ${t.motifLiberationTexte} is null)`,
    ),
    check(
      'reservation_piece_satisfaite_coherente_chk',
      sql`${t.statut} <> 'satisfaite' or (${t.satisfaiteLe} is not null and ${t.mouvementSortieId} is not null and ${t.libereeLe} is null and ${t.motifLiberation} is null)`,
    ),
    check(
      'reservation_piece_liberee_coherente_chk',
      sql`${t.statut} <> 'liberee' or (${t.libereeLe} is not null and ${t.motifLiberation} is not null and ${t.satisfaiteLe} is null and ${t.mouvementSortieId} is null)`,
    ),
    check(
      'reservation_piece_motif_texte_chk',
      sql`(${t.motifLiberation} = 'liberation_manuelle') = (${t.motifLiberationTexte} is not null)`,
    ),
    index('reservation_piece_disponibilite_idx').on(t.tenantId, t.articleId, t.siteId, t.statut),
    index('reservation_piece_ordre_reparation_idx').on(t.tenantId, t.ordreReparationId, t.statut),
    index('reservation_piece_pagination_idx').on(t.tenantId, t.creeLe.desc(), t.id.desc()),
  ],
);

export type LigneReservationPiece = typeof reservationPiece.$inferSelect;
export type NouvelleReservationPiece = typeof reservationPiece.$inferInsert;
