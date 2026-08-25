/**
 * Module pièces — `article`, `article_reference`. RP-01→RP-08.
 * Détail des règles, triggers (numérotation, FK croisée reference_remplacement_id) :
 * migrations/0022_pieces_referentiel.sql.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  colonneCreeLe,
  colonnesHorodatage,
  colonneId,
  colonneTenantId,
} from '../colonnes-communes';
import { tenant } from '../tenant';
// Import direct du fichier (pas du barrel '../facturation') : même précaution que
// atelier/ordre-reparation.ts (Z-17, 0011) — enums.ts n'importe rien de pieces, ce chemin direct
// est sûr.
import { origineDocumentEnum } from '../facturation/enums';
import { categorieArticleEnum, statutArticleEnum, typeReferenceArticleEnum } from './enums';
import { fournisseur } from './fournisseur';

/**
 * `numero_article` : nullable côté Drizzle bien qu'en pratique toujours renseigné après INSERT —
 * `attribuer_numero_article()` (trigger BEFORE INSERT, 0022) l'attribue si absent depuis
 * `article_numero_seq`. Nullable pour la même raison que `ordre_reparation.numero_origine`
 * (0011) : laisser la porte ouverte à une reprise verbatim future, jamais exploitée aujourd'hui.
 *
 * `reference_remplacement_id` : FK RÉELLE vers `article_reference` en base (posée par `alter
 * table` APRÈS la création de `article_reference`, 0022 §5) — NON MODÉLISÉE ici côté Drizzle :
 * un cycle de dépendance authentique (`article` → `article_reference` → `article`, chacune ayant
 * besoin de l'objet `pgTable` de l'autre pour sa propre `foreignKey()`) qu'un seul fichier
 * TypeScript ne peut pas exprimer sans référence circulaire à l'exécution (`const article =
 * pgTable(..., (t) => [...articleReference...])` s'exécute avant que `articleReference` ne soit
 * initialisée plus bas dans le même module — `ReferenceError` en zone morte temporelle). Même
 * doctrine que les colonnes GENERATED de `document_vente` (schema/facturation/document-vente.ts,
 * en-tête) : « posé en SQL brut, non modélisable proprement — le SQL de la migration fait foi,
 * `drizzle-kit generate` sert de contrôle de dérive, pas de source de vérité ». La colonne
 * elle-même reste modélisée (lecture/écriture typées), seule sa contrainte FK ne l'est pas.
 */
export const article = pgTable(
  'article',
  {
    id: colonneId(),
    tenantId: colonneTenantId().references(() => tenant.id, { onDelete: 'restrict' }),
    numeroArticle: text('numero_article'),
    /**
     * Reprise (migrations/0066_ancrages_origine_reprise.sql) : même enum et même sémantique que
     * documentVente.origine (0010) et ordreReparation.origine (0011) — dfa (créé par DFA) ou
     * reprise (importé). Orthogonal à numeroArticle (0022, numéro AFFICHÉ attribué par le
     * trigger si absent) : voir l'en-tête de 0066 pour la distinction.
     */
    origine: origineDocumentEnum('origine').notNull().default('dfa'),
    /** Reprise (0066) : référence article source verbatim, jamais retouchée. NULL si
     * origine=dfa. numeroArticle (0022) reste le numéro DFA affiché, distinct de cette colonne. */
    numeroOrigine: text('numero_origine'),
    designation: text('designation').notNull(),
    marque: text('marque'),
    categorie: categorieArticleEnum('categorie').notNull(),
    statut: statutArticleEnum('statut').notNull().default('actif'),
    referencePrincipale: text('reference_principale').notNull(),
    codeBarres: text('code_barres'),
    /** RP-33 : jamais réécrit par une saisie manuelle — uniquement par mouvement_stock_appliquer_physique() (0025). */
    prixAchatCentimes: integer('prix_achat_centimes'),
    prixVenteTtcCentimes: integer('prix_vente_ttc_centimes').notNull(),
    tauxTvaPourmille: smallint('taux_tva_pourmille').notNull().default(81),
    estEchangeStandard: boolean('est_echange_standard').notNull().default(false),
    montantConsigneTtcCentimes: integer('montant_consigne_ttc_centimes'),
    referenceRemplacementId: uuid('reference_remplacement_id'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('article_tenant_id_uk').on(t.tenantId, t.id),
    // article_tenant_numero_uk (index unique PARTIEL, where numero_article is not null — 0022)
    // n'est pas modélisable via `unique()` de pg-core (pas de clause WHERE) : posé en SQL brut,
    // même limite que ordre_reparation_numero_origine_uk (0011).
    // article_fk_reference_remplacement (FK vers article_reference, 0022 §5) : non modélisée ici,
    // voir le commentaire de reference_remplacement_id ci-dessus (cycle de dépendance réel).
    check('article_designation_non_vide_chk', sql`length(btrim(${t.designation})) > 0`),
    check(
      'article_reference_principale_non_vide_chk',
      sql`length(btrim(${t.referencePrincipale})) > 0`,
    ),
    check('article_prix_vente_chk', sql`${t.prixVenteTtcCentimes} >= 0`),
    check(
      'article_prix_achat_chk',
      sql`${t.prixAchatCentimes} is null or ${t.prixAchatCentimes} >= 0`,
    ),
    check('article_taux_tva_chk', sql`${t.tauxTvaPourmille} between 0 and 1000`),
    check(
      'article_consigne_coherente_chk',
      sql`${t.estEchangeStandard} = (${t.montantConsigneTtcCentimes} is not null)`,
    ),
    check(
      'article_montant_consigne_chk',
      sql`${t.montantConsigneTtcCentimes} is null or ${t.montantConsigneTtcCentimes} >= 0`,
    ),
    // Reprise (0066) : même patron que ordre_reparation_origine_numero_origine_chk (0011).
    check(
      'article_origine_numero_origine_chk',
      sql`(${t.origine} = 'dfa') = (${t.numeroOrigine} is null)`,
    ),
    // article_numero_origine_uk (index unique PARTIEL, where numero_origine is not null — 0066)
    // n'est pas modélisable via `unique()` de pg-core (pas de clause WHERE) : posé en SQL brut,
    // même limite que article_tenant_numero_uk (0022) et ordre_reparation_numero_origine_uk
    // (0011).
    index('article_designation_idx').on(t.tenantId, t.designation),
    index('article_reference_principale_idx').on(t.tenantId, t.referencePrincipale),
    index('article_statut_idx').on(t.tenantId, t.statut),
    index('article_pagination_idx').on(t.tenantId, t.creeLe.desc(), t.id.desc()),
    index('article_reference_remplacement_idx')
      .on(t.tenantId, t.referenceRemplacementId)
      .where(sql`${t.referenceRemplacementId} is not null`),
  ],
);

/**
 * `reference` UNIQUE PAR TENANT (`article_reference_tenant_reference_uk`), tous types/articles
 * confondus — décision de conception documentée en 0022 : c'est ce qui rend RP-03 vrai en base.
 * DIVERGENCE SIGNALÉE côté contrat (`article.ts`, commentaire "upsert sur (articleId, type,
 * reference)") : le service doit upserter sur `(tenantId, reference)`, pas sur le triplet.
 */
export const articleReference = pgTable(
  'article_reference',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    articleId: uuid('article_id').notNull(),
    type: typeReferenceArticleEnum('type').notNull(),
    reference: text('reference').notNull(),
    fournisseurId: uuid('fournisseur_id'),
    creeLe: colonneCreeLe(),
  },
  (t) => [
    unique('article_reference_tenant_id_uk').on(t.tenantId, t.id),
    unique('article_reference_tenant_reference_uk').on(t.tenantId, t.reference),
    foreignKey({
      name: 'article_reference_fk_article',
      columns: [t.tenantId, t.articleId],
      foreignColumns: [article.tenantId, article.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'article_reference_fk_fournisseur',
      columns: [t.tenantId, t.fournisseurId],
      foreignColumns: [fournisseur.tenantId, fournisseur.id],
    }).onDelete('restrict'),
    check('article_reference_non_vide_chk', sql`length(btrim(${t.reference})) > 0`),
    check(
      'article_reference_fournisseur_coherent_chk',
      sql`(${t.type} = 'fournisseur') = (${t.fournisseurId} is not null)`,
    ),
    index('article_reference_article_idx').on(t.tenantId, t.articleId),
    index('article_reference_fournisseur_idx')
      .on(t.tenantId, t.fournisseurId)
      .where(sql`${t.fournisseurId} is not null`),
  ],
);

export type LigneArticle = typeof article.$inferSelect;
export type NouvelArticle = typeof article.$inferInsert;
export type LigneArticleReference = typeof articleReference.$inferSelect;
export type NouvelleArticleReference = typeof articleReference.$inferInsert;
