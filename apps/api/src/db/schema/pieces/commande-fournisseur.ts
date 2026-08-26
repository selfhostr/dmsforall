/**
 * Module pièces — `commande_fournisseur`, `commande_fournisseur_ligne`. RP-26→RP-31, §6.2.
 * Détail des règles, machine à états (transition_autorisee/verifier_transition, dispositif
 * générique de 0003) : migrations/0023_pieces_entite_auditee_commande_fournisseur.sql,
 * 0024_pieces_commande_fournisseur.sql.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { colonnesHorodatage, colonneId } from '../colonnes-communes';
import { site } from '../site';
import { tenant } from '../tenant';
import { ligneOr } from '../atelier/ordre-reparation';
// Import direct du fichier (pas du barrel '../facturation') : même précaution que
// atelier/client.ts (0066) — enums.ts n'importe rien de pieces, ce chemin direct est sûr.
import { origineDocumentEnum } from '../facturation/enums';
import { article } from './article';
import { origineCommandeFournisseurEnum, statutCommandeFournisseurEnum } from './enums';
import { fournisseur } from './fournisseur';

export const commandeFournisseur = pgTable(
  'commande_fournisseur',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'restrict' }),
    fournisseurId: uuid('fournisseur_id').notNull(),
    siteId: uuid('site_id').notNull(),
    statut: statutCommandeFournisseurEnum('statut').notNull().default('brouillon'),
    origine: origineCommandeFournisseurEnum('origine').notNull().default('manuelle'),
    /**
     * Reprise (migrations/0070_ancrages_origine_reprise_pneus_ventes_relances.sql) : dfa (créé
     * par DFA) ou reprise (importé) — nommée `origineReprise` (pas `origine`) car cette table
     * porte déjà `origine` (ci-dessus, RP-26 : pourquoi la commande est née dans DFA), sans
     * rapport avec la provenance DFA/import. Même enum/sémantique que client.origine (0066).
     */
    origineReprise: origineDocumentEnum('origine_reprise').notNull().default('dfa'),
    /** Reprise (0070) : référence de commande source verbatim, jamais retouchée. NULL si
     *  origineReprise=dfa. */
    numeroOrigine: text('numero_origine'),
    dateCommande: date('date_commande').notNull().defaultNow(),
    envoyeeLe: timestamp('envoyee_le', { withTimezone: true, mode: 'date' }),
    reference: text('reference'),
    // 0034 : raison saisie à l'annulation (brouillon/envoyee -> annulee), exigée par la CHECK
    // ci-dessous — rend réellement opposable exige_motif=true de transition_autorisee (0024 §4),
    // que verifier_transition() (0003 §6) ne lit lui-même jamais.
    motifAnnulation: text('motif_annulation'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('commande_fournisseur_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'commande_fournisseur_fk_fournisseur',
      columns: [t.tenantId, t.fournisseurId],
      foreignColumns: [fournisseur.tenantId, fournisseur.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'commande_fournisseur_fk_site',
      columns: [t.tenantId, t.siteId],
      foreignColumns: [site.tenantId, site.id],
    }).onDelete('restrict'),
    check(
      'commande_fournisseur_envoyee_coherente_chk',
      sql`${t.statut} <> 'brouillon' or ${t.envoyeeLe} is null`,
    ),
    check(
      'commande_fournisseur_annulation_coherente_chk',
      sql`${t.statut} <> 'annulee' or ${t.motifAnnulation} is not null`,
    ),
    // Reprise (0070) : même patron que ordre_reparation_origine_numero_origine_chk (0011),
    // colonne origineReprise (pas origine, déjà prise) — voir en-tête de la colonne ci-dessus.
    check(
      'commande_fournisseur_origine_numero_origine_chk',
      sql`(${t.origineReprise} = 'dfa') = (${t.numeroOrigine} is null)`,
    ),
    // commande_fournisseur_numero_origine_uk (index unique PARTIEL, where numero_origine is not
    // null — 0070) n'est pas modélisable via `unique()` de pg-core (pas de clause WHERE) : posé
    // en SQL brut, même limite que ordre_reparation_numero_origine_uk (0011).
    index('commande_fournisseur_pagination_idx').on(t.tenantId, t.creeLe.desc(), t.id.desc()),
    index('commande_fournisseur_fournisseur_idx').on(t.tenantId, t.fournisseurId),
    index('commande_fournisseur_site_statut_idx').on(t.tenantId, t.siteId, t.statut),
  ],
);

/**
 * `quantiteReliquatMillieme` est une colonne GÉNÉRÉE (posée en SQL brut, 0024) — NON modélisée
 * ici, même doctrine que `document_vente.numero_normalise` (schema/facturation/document-vente.ts,
 * en-tête) : `max(0, quantite_commandee - quantite_recue_cumulee)`, sauf `reliquat_annule_le`
 * renseigné auquel cas elle vaut `0` quel que soit le cumul reçu (RP-28).
 */
export const commandeFournisseurLigne = pgTable(
  'commande_fournisseur_ligne',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    commandeFournisseurId: uuid('commande_fournisseur_id').notNull(),
    numeroOrdre: smallint('numero_ordre').notNull(),
    articleId: uuid('article_id').notNull(),
    quantiteCommandeeMillieme: integer('quantite_commandee_millieme').notNull(),
    quantiteRecueCumuleeMillieme: integer('quantite_recue_cumulee_millieme').notNull().default(0),
    reliquatAnnuleLe: timestamp('reliquat_annule_le', { withTimezone: true, mode: 'date' }),
    reliquatMotifAnnulation: text('reliquat_motif_annulation'),
    prixAchatAttenduCentimes: integer('prix_achat_attendu_centimes'),
    ligneOrOrigineId: uuid('ligne_or_origine_id'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('commande_fournisseur_ligne_tenant_id_uk').on(t.tenantId, t.id),
    unique('commande_fournisseur_ligne_tenant_cmd_ordre_uk').on(
      t.tenantId,
      t.commandeFournisseurId,
      t.numeroOrdre,
    ),
    foreignKey({
      name: 'commande_fournisseur_ligne_fk_commande',
      columns: [t.tenantId, t.commandeFournisseurId],
      foreignColumns: [commandeFournisseur.tenantId, commandeFournisseur.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'commande_fournisseur_ligne_fk_article',
      columns: [t.tenantId, t.articleId],
      foreignColumns: [article.tenantId, article.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'commande_fournisseur_ligne_fk_ligne_or',
      columns: [t.tenantId, t.ligneOrOrigineId],
      foreignColumns: [ligneOr.tenantId, ligneOr.id],
    }).onDelete('restrict'),
    check(
      'commande_fournisseur_ligne_quantite_commandee_chk',
      sql`${t.quantiteCommandeeMillieme} > 0`,
    ),
    check(
      'commande_fournisseur_ligne_quantite_recue_chk',
      sql`${t.quantiteRecueCumuleeMillieme} >= 0`,
    ),
    check(
      'commande_fournisseur_ligne_prix_attendu_chk',
      sql`${t.prixAchatAttenduCentimes} is null or ${t.prixAchatAttenduCentimes} >= 0`,
    ),
    check(
      'commande_fournisseur_ligne_reliquat_motif_chk',
      sql`(${t.reliquatAnnuleLe} is null) = (${t.reliquatMotifAnnulation} is null)`,
    ),
    index('commande_fournisseur_ligne_commande_idx').on(
      t.tenantId,
      t.commandeFournisseurId,
      t.numeroOrdre,
    ),
    index('commande_fournisseur_ligne_article_idx').on(t.tenantId, t.articleId),
    index('commande_fournisseur_ligne_or_origine_idx')
      .on(t.tenantId, t.ligneOrOrigineId)
      .where(sql`${t.ligneOrOrigineId} is not null`),
  ],
);

export type LigneCommandeFournisseur = typeof commandeFournisseur.$inferSelect;
export type NouvelleCommandeFournisseur = typeof commandeFournisseur.$inferInsert;
export type LigneCommandeFournisseurLigne = typeof commandeFournisseurLigne.$inferSelect;
export type NouvelleCommandeFournisseurLigne = typeof commandeFournisseurLigne.$inferInsert;
