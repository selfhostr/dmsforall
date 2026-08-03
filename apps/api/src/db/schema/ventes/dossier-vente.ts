/**
 * Module ventes — `dossier_vente`. RV-29→RV-38, RV-52→RV-58, §6.2, §8.2. Contrat gelé :
 * `packages/shared/src/contrats/ventes/dossier-vente.ts` (`ReponseDossierVente`).
 * Détail des règles, triggers et machine à états : migrations/0032_ventes.sql.
 *
 * NON MODÉLISÉ ICI, volontairement, contrat à l'appui :
 *   - `typeVehicule` — DÉRIVÉ, jamais stocké (même doctrine que `vehicule-stock.ts`) ;
 *   - `prospectionLe` — TOUJOURS égal à `creeLe` (un dossier naît en `prospection`, jamais
 *     autrement) : le service mappe `creeLe` → `prospectionLe` dans sa réponse, une colonne
 *     dupliquée n'ajouterait qu'un risque de désynchronisation pour zéro information nouvelle ;
 *   - `kilometrageDepart` (RV-55) — contrat, littéral : « renseigné par schemaActionLivrer… via le
 *     mécanisme de kilométrage déjà existant côté véhicule » : une ligne `vehicule_kilometrage`
 *     (schema/atelier/vehicule.ts), pas une colonne ici — ne duplique pas ;
 *   - `documentsRequis` (RV-35, check-list de livraison) — table séparée
 *     `dossier_vente_document_requis` (`document-requis.ts`), pas une colonne JSON ici : chaque
 *     item a son propre cycle `fourni`/`fourniLe`, coché indépendamment (`POST
 *     .../documents-requis/marquer`) ;
 *   - `documents` (chaîne facturation) — projection en lecture via `document_vente.dossier_vente_id`,
 *     déjà posé à l'étape 2, FK ajoutée dans `migrations/0032_ventes.sql` §7 ;
 *   - `reprise`/`financement`/`financements` — tables séparées (`reprise.ts`, `financement.ts`),
 *     rattachées par `dossier_vente_id`, jamais embarquées en colonnes ici.
 */

import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { colonneId, colonnesHorodatage } from '../colonnes-communes';
import { tenant } from '../tenant';
import { site } from '../site';
import { client } from '../atelier/client';
import { statutDossierVenteEnum } from './enums';
import { vehiculeStock } from './vehicule-stock';

/**
 * L'objet central du module (RV-29) : lie un véhicule en stock (optionnel avant `engage`,
 * RV-30), un client acheteur, une reprise optionnelle (`reprise.ts`), un financement optionnel
 * (`financement.ts`), et les documents de la chaîne facturation existante via
 * `document_vente.dossier_vente_id` (accroche posée à l'étape 2, FK ajoutée dans
 * `migrations/0032_ventes.sql` maintenant que cette table existe).
 */
export const dossierVente = pgTable(
  'dossier_vente',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'restrict' }),
    siteId: uuid('site_id').notNull(),
    /** Colonne SQL nommée `statut` (dispositif générique `verifier_transition()`, voir le
     *  commentaire équivalent sur `vehicule_stock.statutCommercial`). */
    statut: statutDossierVenteEnum('statut').notNull().default('prospection'),
    /** RV-30 : nullable tant que `statut = 'prospection'` — devient obligatoire au passage à
     *  `engage` (CHECK ci-dessous). Référence `vehicule_stock`, pas `vehicule` directement : RV-29
     *  dit explicitement « lie un véhicule EN STOCK ». */
    vehiculeId: uuid('vehicule_id'),
    clientAcheteurId: uuid('client_acheteur_id').notNull(),
    /** RV-40 : destinataire de la facture si leasing (organisme) ou adresse comptabilité distincte
     *  (RV-36) — `null` = même client que l'acheteur. */
    clientFactureId: uuid('client_facture_id'),
    /** RV-36 : conducteur attitré si différent du signataire (flotte entreprise). */
    clientConducteurId: uuid('client_conducteur_id'),
    /** RV-15 : obligatoire en pratique pour un VN, optionnelle pour une VO — non forcé par un
     *  CHECK ici faute de colonne fiable distinguant VN/VO à ce niveau (`typeVehicule` est dérivé,
     *  calculé à la lecture, jamais stocké — voir `contrats/ventes/enums.ts::TypeVehiculeVente`) ;
     *  la règle appartient au service, qui connaît la provenance du véhicule lié. */
    dateLivraisonEstimee: date('date_livraison_estimee'),
    dateLivraisonEffective: date('date_livraison_effective'),
    /** RV-34 : identité vérifiée à la signature du bon de commande — renseignés par l'action
     *  `engager` (`schemaActionEngager.identitePieceType`, obligatoire à cette action), `null`
     *  avant. Texte libre (pas d'enum fermé, le contrat le dit explicitement : la liste des pièces
     *  acceptées est une question de conformité terrain, pas de ce module). */
    identitePieceType: text('identite_piece_type'),
    identiteVerifieeLe: timestamp('identite_verifiee_le', { withTimezone: true, mode: 'date' }),
    /** Horodatage de chaque transition du diagramme §6.2 — un par état entrant (hors
     *  `prospection`, voir la note d'en-tête). Contrat : `engageLe`, `enPreparationLe`,
     *  `pretALivrerLe`, `livreLe`, `closLe`, `annuleLe`, `abandonneLe` sur `ReponseDossierVente`,
     *  tous exposés séparément — jamais dérivés d'une seule colonne `statutChangeLe`. */
    engageLe: timestamp('engage_le', { withTimezone: true, mode: 'date' }),
    enPreparationLe: timestamp('en_preparation_le', { withTimezone: true, mode: 'date' }),
    pretALivrerLe: timestamp('pret_a_livrer_le', { withTimezone: true, mode: 'date' }),
    livreLe: timestamp('livre_le', { withTimezone: true, mode: 'date' }),
    closLe: timestamp('clos_le', { withTimezone: true, mode: 'date' }),
    annuleLe: timestamp('annule_le', { withTimezone: true, mode: 'date' }),
    abandonneLe: timestamp('abandonne_le', { withTimezone: true, mode: 'date' }),
    /** Motif de `annule`/`abandonne` — même doctrine que `vehicule_stock.dernier_motif_transition`
     *  et `vehicule_travail_reporte.motif_refus` : valeur courante seule, l'historique complet vit
     *  dans `audit_atelier`. */
    motifCloture: text('motif_cloture'),
    /** Concurrence optimiste (`If-Match`), même patron que `ordre_reparation.version`. */
    version: integer('version').notNull().default(1),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('dossier_vente_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'dossier_vente_fk_site',
      columns: [t.tenantId, t.siteId],
      foreignColumns: [site.tenantId, site.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'dossier_vente_fk_vehicule_stock',
      columns: [t.tenantId, t.vehiculeId],
      foreignColumns: [vehiculeStock.tenantId, vehiculeStock.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'dossier_vente_fk_client_acheteur',
      columns: [t.tenantId, t.clientAcheteurId],
      foreignColumns: [client.tenantId, client.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'dossier_vente_fk_client_facture',
      columns: [t.tenantId, t.clientFactureId],
      foreignColumns: [client.tenantId, client.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'dossier_vente_fk_client_conducteur',
      columns: [t.tenantId, t.clientConducteurId],
      foreignColumns: [client.tenantId, client.id],
    }).onDelete('restrict'),
    // RV-30, littéral : « l'association au véhicule en stock devient obligatoire au passage à
    // l'état engagé ».
    check(
      'dossier_vente_vehicule_requis_engage_chk',
      sql`${t.statut} = 'prospection' or ${t.vehiculeId} is not null`,
    ),
    check(
      'dossier_vente_motif_cloture_chk',
      sql`${t.statut} not in ('annule', 'abandonne') or ${t.motifCloture} is not null`,
    ),
    // RV-10 : un véhicule engagé (bon de commande signé ou au-delà, avant facturation) ne peut
    // pas être engagé par un second dossier en même temps — verrou de concurrence en base, pas
    // seulement une règle de service (CV-01). `prospection` (simple devis) et les états
    // post-facturation (`livre`, `clos`) sont volontairement EXCLUS : un même véhicule physique
    // peut légitimement redevenir l'objet d'une reprise puis d'une nouvelle vente des années plus
    // tard (§7.6, CV-06) — un index unique permanent bloquerait ce cas réel.
    uniqueIndex('dossier_vente_vehicule_engage_uk')
      .on(t.tenantId, t.vehiculeId)
      .where(
        sql`${t.vehiculeId} is not null and ${t.statut} in ('engage', 'en_preparation', 'pret_a_livrer')`,
      ),
    index('dossier_vente_pagination_idx').on(t.tenantId, t.creeLe.desc(), t.id.desc()),
    index('dossier_vente_client_acheteur_idx').on(t.tenantId, t.clientAcheteurId),
    index('dossier_vente_statut_idx').on(t.tenantId, t.statut),
  ],
);

export type LigneDossierVente = typeof dossierVente.$inferSelect;
export type NouveauDossierVente = typeof dossierVente.$inferInsert;
