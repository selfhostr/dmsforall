/**
 * Module ventes — `vehicule_stock`. RV-01→RV-14, §6.1, §8.1. Contrat gelé (partiel) :
 * `packages/shared/src/contrats/ventes/vehicule-stock.ts`.
 * Détail des règles, triggers et machine à états : migrations/0032_ventes.sql.
 */

import { boolean, check, date, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { colonnesHorodatage } from '../colonnes-communes';
import { tenant } from '../tenant';
import { site } from '../site';
import { vehicule } from '../atelier/vehicule';
import { statutCommercialVehiculeEnum } from './enums';

/**
 * Extension 1:1 de `vehicule` (RV-01, littéral : « il n'existe pas de table véhicule de vente
 * séparée du véhicule atelier »). `id` **EST** `vehicule.id` — pas de `defaultRandom()`, la
 * valeur est fournie par le service au moment de la mise en stock d'un véhicule déjà créé (étape
 * 1, `contrats/ventes/vehicule-stock.ts::ReponseVehiculeStock.id`, littéral : « il n'existe pas
 * de second identifiant »). FK composite `(tenant_id, id) → vehicule(tenant_id, id)` : la simple
 * EXISTENCE d'une ligne ici est le marqueur « ce véhicule est/a été en stock », pas une colonne
 * séparée portée par `vehicule`.
 *
 * SIGNALÉ (hors périmètre d'écriture de ce module — `schema/atelier/vehicule.ts` appartient à un
 * autre module) : `vehicule` porte déjà une colonne `vehicule_stock_id uuid` posée par avance à
 * l'étape 1 (commentaire : « Accroche étape 4 (véhicules en stock) : sans FK tant que la cible
 * n'existe pas »). Avec ce design (identifiant partagé), cette colonne devient un second pointeur
 * redondant vers exactement l'information qu'un test d'existence
 * `exists (select 1 from vehicule_stock where id = vehicule.id)` donne sans aucun risque de
 * désynchronisation — l'anti-patron « deux sources pour une même vérité » que ce dépôt évite
 * explicitement ailleurs (voir le commentaire de `quantite_reliquat_millieme`,
 * migrations/0024_pieces_commande_fournisseur.sql). Recommandation transmise à l'orchestrateur :
 * retirer `vehicule.vehicule_stock_id` dans une migration future plutôt que d'y poser une FK qui
 * cimenterait la redondance.
 *
 * `origine_reprise_dossier_vente_id` n'est PAS modélisé comme `foreignKey()` ici : une FK directe
 * créerait un cycle d'import ES entre `vehicule-stock.ts` (qui devrait importer `dossierVente`) et
 * `dossier-vente.ts` (qui importe déjà `vehiculeStock` pour SA propre FK `vehicule_id`). La
 * colonne existe (uuid nullable), la contrainte FK est posée en SQL brut dans
 * `migrations/0032_ventes.sql` une fois les deux tables créées — même doctrine que les colonnes
 * GENERATED de ce dépôt (SQL fait foi, Drizzle sert de contrôle de dérive sur le reste).
 */
export const vehiculeStock = pgTable(
  'vehicule_stock',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenant.id, { onDelete: 'restrict' }),
    siteId: uuid('site_id').notNull(),
    /** RV-02, PV-05 : liste EXTENSIBLE **par tenant** (pas seulement par migration produit) — texte
     *  libre plutôt qu'un enum PG partagé par tous les tenants, même choix que
     *  `contrats/ventes/vehicule-stock.ts::schemaMiseEnStock` (`z.string()`, jamais
     *  `z.enum(PROVENANCES_VEHICULE_STOCK)`). */
    provenance: text('provenance').notNull(),
    dateEntreeStock: date('date_entree_stock').notNull(),
    /** RV-03 : obligatoire dès l'entrée en stock. Sur une reprise, c'est la VALEUR NÉGOCIÉE (pas
     *  estimée) qui est recopiée ici (RV-24) — recopie faite par le service, pas par une contrainte
     *  de cette table (elle ne connaît pas `reprise` par FK directe, voir doctrine ci-dessus). */
    prixAchatCentimes: integer('prix_achat_centimes').notNull(),
    /** RV-05 : `null` tant qu'aucun prix n'est fixé (VN pas encore chiffré). */
    prixVenteAfficheCentimes: integer('prix_vente_affiche_centimes'),
    /**
     * RV-09 — colonne SQL nommée `statut` (pas `statut_commercial`) : le dispositif générique
     * `verifier_transition()` (migrations/0003 §6) lit littéralement `old.statut`/`new.statut`,
     * quel que soit le nom de propriété TypeScript exposé côté Drizzle/API. Aucune collision avec
     * `vehicule.statut` (`actif`/`archive`) : deux tables distinctes, RV-09 le dit explicitement
     * (« il ne remplace pas statut_vehicule »).
     */
    statutCommercial: statutCommercialVehiculeEnum('statut').notNull(),
    /** RV-60 : `null` sauf `provenance` ∈ {`reprise`, `achat_particulier`} — donnée fournie à la
     *  facturation pour l'impôt préalable fictif (LTVA art. 28a, calcul hors périmètre ici, QF-07
     *  non tranché). */
    vendeurPrecedentAssujetti: boolean('vendeur_precedent_assujetti'),
    /** Traçabilité (RV-24) : `null` sauf `provenance = 'reprise'`. FK posée en SQL brut, voir
     *  doctrine ci-dessus. */
    origineRepriseDossierVenteId: uuid('origine_reprise_dossier_vente_id'),
    /** Trace de la dernière correction EXCEPTIONNELLE de statut (ex. `remettre-disponible` motif
     *  obligatoire, `contrats/ventes/vehicule-stock.ts::schemaRemettreDisponibleVehiculeStock`) —
     *  même doctrine que `vehicule_travail_reporte.motif_refus`
     *  (`schema/atelier/vehicule.ts`) : valeur courante seule, l'historique complet vit dans
     *  `audit_atelier` (snapshot avant/après à chaque UPDATE). */
    dernierMotifTransition: text('dernier_motif_transition'),
    receptionneLe: timestamp('receptionne_le', { withTimezone: true, mode: 'date' }),
    reserveLe: timestamp('reserve_le', { withTimezone: true, mode: 'date' }),
    venduLe: timestamp('vendu_le', { withTimezone: true, mode: 'date' }),
    livreLe: timestamp('livre_le', { withTimezone: true, mode: 'date' }),
    /** Concurrence optimiste (`If-Match`), même patron que `ordre_reparation.version`
     *  (`schema/atelier/ordre-reparation.ts:115`). */
    version: integer('version').notNull().default(1),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('vehicule_stock_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'vehicule_stock_fk_vehicule',
      columns: [t.tenantId, t.id],
      foreignColumns: [vehicule.tenantId, vehicule.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'vehicule_stock_fk_site',
      columns: [t.tenantId, t.siteId],
      foreignColumns: [site.tenantId, site.id],
    }).onDelete('restrict'),
    check('vehicule_stock_provenance_non_vide_chk', sql`length(btrim(${t.provenance})) > 0`),
    check('vehicule_stock_prix_achat_chk', sql`${t.prixAchatCentimes} >= 0`),
    check(
      'vehicule_stock_prix_vente_affiche_chk',
      sql`${t.prixVenteAfficheCentimes} is null or ${t.prixVenteAfficheCentimes} >= 0`,
    ),
    check(
      'vehicule_stock_origine_reprise_coherente_chk',
      sql`${t.origineRepriseDossierVenteId} is null or ${t.provenance} = 'reprise'`,
    ),
    // RV-09 : « en_commande » (VN pas encore livré au garage) n'a de sens que pour une provenance
    // neuf_constructeur — les autres provenances entrent toujours directement `disponible`.
    check(
      'vehicule_stock_en_commande_provenance_chk',
      sql`${t.statutCommercial} <> 'en_commande' or ${t.provenance} = 'neuf_constructeur'`,
    ),
    index('vehicule_stock_site_statut_idx').on(t.tenantId, t.siteId, t.statutCommercial),
    index('vehicule_stock_date_entree_idx').on(t.tenantId, t.dateEntreeStock.desc()),
    index('vehicule_stock_prix_vente_idx')
      .on(t.tenantId, t.prixVenteAfficheCentimes)
      .where(sql`${t.prixVenteAfficheCentimes} is not null`),
    index('vehicule_stock_origine_reprise_idx')
      .on(t.tenantId, t.origineRepriseDossierVenteId)
      .where(sql`${t.origineRepriseDossierVenteId} is not null`),
  ],
);

export type LigneVehiculeStock = typeof vehiculeStock.$inferSelect;
export type NouveauVehiculeStock = typeof vehiculeStock.$inferInsert;
