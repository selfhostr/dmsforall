/**
 * Module véhicules — `vehicule`, `vehicule_plaque`, `vehicule_detention`, `vehicule_kilometrage`,
 * `vehicule_expertise`, `vehicule_campagne`, `vehicule_travail_reporte`.
 * Détail des règles : migrations/0007_vehicules.sql (FK vers `ordre_reparation`/`ligne_or`
 * ajoutées par migrations/0008_atelier.sql, non modélisées ici — Drizzle ne décrit qu'un état
 * final, les deux migrations ensemble).
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
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

import {
  colonneCreeLe,
  colonnesHorodatage,
  colonneId,
  colonneTenantId,
} from '../colonnes-communes';
import { tenant } from '../tenant';
import { utilisateur } from '../utilisateur';
// Import direct du fichier (pas du barrel '../facturation') : même précaution que
// atelier/ordre-reparation.ts (Z-17, 0011) et atelier/client.ts (0066) — enums.ts n'importe rien
// d'atelier, ce chemin direct est sûr.
import { origineDocumentEnum } from '../facturation/enums';
import { typeApprobationCh } from '../referentiel/type-approbation-ch';
import { client } from './client';
import {
  motifArchivageVehiculeEnum,
  motifFinDetentionEnum,
  motifKilometrageRegressifEnum,
  resultatExpertiseEnum,
  sourceEcheanceExpertiseEnum,
  sourceKilometrageEnum,
  statutCampagneEnum,
  statutTravailReporteEnum,
  statutVehiculeEnum,
  uniteDistanceEnum,
  urgenceTravailEnum,
} from './enums';

export const vehicule = pgTable(
  'vehicule',
  {
    id: colonneId(),
    tenantId: colonneTenantId().references(() => tenant.id, { onDelete: 'restrict' }),
    /**
     * Reprise (migrations/0066_ancrages_origine_reprise.sql) : même enum et même sémantique que
     * documentVente.origine (0010) et ordreReparation.origine (0011) — dfa (créé par DFA) ou
     * reprise (importé). Revient sur l'exclusion explicite de 0011 (« vehicule N'EST PAS
     * aligné ») : voir l'en-tête de 0066 pour la justification et le commentaire sur
     * numeroOrigine ci-dessous.
     */
    origine: origineDocumentEnum('origine').notNull().default('dfa'),
    /** Reprise (0066) : identifiant véhicule source verbatim, jamais retouché. NULL si
     * origine=dfa. Distinct de vin/vehiculePlaque, qui restent les identifiants métier stables. */
    numeroOrigine: text('numero_origine'),
    vin: text('vin'),
    marque: text('marque').notNull(),
    modele: text('modele').notNull(),
    version: text('version'),
    finition: text('finition'),
    codeTypeCh: text('code_type_ch'),
    date1reCirculation: date('date_1re_circulation'),
    carburant: text('carburant'),
    cylindreeCm3: integer('cylindree_cm3'),
    puissanceKw: integer('puissance_kw'),
    boite: text('boite'),
    transmission: text('transmission'),
    normeEmission: text('norme_emission'),
    couleur: text('couleur'),
    codeCouleur: text('code_couleur'),
    poidsVideKg: integer('poids_vide_kg'),
    poidsTotalKg: integer('poids_total_kg'),
    places: smallint('places'),
    pneusEte: text('pneus_ete'),
    pneusHiver: text('pneus_hiver'),
    pressionPneus: text('pression_pneus'),
    huileType: text('huile_type'),
    huileQuantiteDl: integer('huile_quantite_dl'),
    batterie: text('batterie'),
    codeRadio: text('code_radio'),
    codeCle: text('code_cle'),
    intervalleEntretienKm: integer('intervalle_entretien_km'),
    intervalleEntretienMois: smallint('intervalle_entretien_mois'),
    importe: boolean('importe').notNull().default(false),
    paysOrigine: char('pays_origine', { length: 2 }),
    dateImportation: date('date_importation'),
    garantieDebut: date('garantie_debut'),
    garantieMois: smallint('garantie_mois'),
    garantieKm: integer('garantie_km'),
    proprietaireEconomiqueClientId: uuid('proprietaire_economique_client_id'),
    conducteurHabituel: text('conducteur_habituel'),
    identificationIncomplete: boolean('identification_incomplete').notNull().default(false),
    statut: statutVehiculeEnum('statut').notNull().default('actif'),
    motifArchivage: motifArchivageVehiculeEnum('motif_archivage'),
    fusionneVersVehiculeId: uuid('fusionne_vers_vehicule_id'),
    /** Accroche étape 4 (véhicules en stock) : sans FK tant que la cible n'existe pas. */
    vehiculeStockId: uuid('vehicule_stock_id'),
    /**
     * Plan du parc, Lot C simplifié (migrations/0044_vehicule_emplacement_libre.sql) : position
     * courante DÉCLARATIVE du véhicule, texte libre (patron `stock_article.emplacement`), borne
     * `.trim().max(60)` applicative uniquement — pas de CHECK de longueur en base (même doctrine
     * que `depot_pneus.code_case`, 0043). Une aide à la mémoire visuelle, PAS une vérité
     * d'inventaire auditée (spec §1.1/§1.3) : aucune contrainte d'unicité, aucun audit, aucun
     * trigger `touche_modifie_le` (voir `emplacementMajLe` ci-dessous).
     */
    emplacementLibre: text('emplacement_libre'),
    /**
     * Dernière fois où `emplacementLibre` a été touché — maintenu par l'APPLICATIF au moment
     * précis où la position est modifiée, PAS par un trigger générique sur `modifieLe` (qui
     * avancerait sur N'IMPORTE QUELLE modification du véhicule, pas seulement sa position).
     */
    emplacementMajLe: timestamp('emplacement_maj_le', { withTimezone: true, mode: 'date' }),
    /**
     * Référentiel véhicules suisse (migrations/0050_referentiel_vehicules_ch.sql) : lien
     * OPTIONNEL et silencieux vers la fiche `type_approbation_ch` qui a servi à préremplir ce
     * véhicule (mode 1 : saisie du code type ; mode 2 : autocomplétion en cascade). PAS une FK
     * composite `(tenant_id, …)` comme les relations ci-dessous : `type_approbation_ch` n'a pas
     * de `tenant_id`, elle est partagée par construction.
     *
     * `marque`/`modele`/`version` (ci-dessus) restent du texte libre et NE deviennent JAMAIS des
     * clés étrangères vers ce référentiel — arbitrage explicite de @laupernoe, à ne pas rouvrir sans
     * revalider les trois modes de saisie (voir l'en-tête de 0050) : le rendre obligatoire
     * bloquerait le mode 3 (saisie 100% libre, véhicule importé/ancien/transformé absent du
     * référentiel) et casserait tous les véhicules déjà saisis en texte libre.
     */
    typeApprobationChId: uuid('type_approbation_ch_id'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('vehicule_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'vehicule_fk_proprietaire_eco',
      columns: [t.tenantId, t.proprietaireEconomiqueClientId],
      foreignColumns: [client.tenantId, client.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'vehicule_fk_fusionne_vers',
      columns: [t.tenantId, t.fusionneVersVehiculeId],
      foreignColumns: [t.tenantId, t.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'vehicule_fk_type_approbation',
      columns: [t.typeApprobationChId],
      foreignColumns: [typeApprobationCh.id],
    }).onDelete('set null'),
    check(
      'vehicule_vin_format_chk',
      sql`${t.vin} is null or length(${t.vin}) <> 17 or ${t.vin} ~ '^[A-HJ-NPR-Z0-9]{17}$'`,
    ),
    check('vehicule_marque_non_vide_chk', sql`length(btrim(${t.marque})) > 0`),
    check('vehicule_modele_non_vide_chk', sql`length(btrim(${t.modele})) > 0`),
    check(
      'vehicule_archivage_coherent_chk',
      sql`(${t.statut} = 'archive') = (${t.motifArchivage} is not null)`,
    ),
    // Reprise (0066) : même patron que ordre_reparation_origine_numero_origine_chk (0011).
    check(
      'vehicule_origine_numero_origine_chk',
      sql`(${t.origine} = 'dfa') = (${t.numeroOrigine} is null)`,
    ),
    index('vehicule_pagination_idx').on(t.tenantId, t.creeLe.desc(), t.id.desc()),
    // vehicule_numero_origine_uk (index unique PARTIEL, where numero_origine is not null — 0066)
    // n'est pas modélisable via `unique()` de pg-core (pas de clause WHERE) : posé en SQL brut,
    // même limite que ordre_reparation_numero_origine_uk (0011).
    /**
     * Sert le `on delete set null` du référentiel (0050) : sans cet index, un réimport qui
     * retire une ligne obsolète de `type_approbation_ch` balaierait `vehicule` en entier — sur
     * tous les tenants, cette colonne n'ayant pas `tenant_id` en tête — pour trouver les lignes à
     * détacher.
     */
    index('vehicule_type_approbation_ch_id_idx').on(t.typeApprobationChId),
  ],
);

export const vehiculePlaque = pgTable(
  'vehicule_plaque',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    vehiculeId: uuid('vehicule_id').notNull(),
    valeur: text('valeur').notNull(),
    canton: char('canton', { length: 2 }),
    pays: char('pays', { length: 2 }).notNull().default('CH'),
    du: date('du').notNull(),
    au: date('au'),
    interchangeable: boolean('interchangeable').notNull().default(false),
    professionnelle: boolean('professionnelle').notNull().default(false),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('vehicule_plaque_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'vehicule_plaque_fk',
      columns: [t.tenantId, t.vehiculeId],
      foreignColumns: [vehicule.tenantId, vehicule.id],
    }).onDelete('restrict'),
    check('vehicule_plaque_valeur_non_vide_chk', sql`length(btrim(${t.valeur})) > 0`),
    index('vehicule_plaque_courante_idx').on(t.tenantId, t.vehiculeId),
  ],
);

export const vehiculeDetention = pgTable(
  'vehicule_detention',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    vehiculeId: uuid('vehicule_id').notNull(),
    clientId: uuid('client_id').notNull(),
    du: date('du').notNull(),
    au: date('au'),
    motifFin: motifFinDetentionEnum('motif_fin'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('vehicule_detention_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'vehicule_detention_fk_vehicule',
      columns: [t.tenantId, t.vehiculeId],
      foreignColumns: [vehicule.tenantId, vehicule.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'vehicule_detention_fk_client',
      columns: [t.tenantId, t.clientId],
      foreignColumns: [client.tenantId, client.id],
    }).onDelete('restrict'),
    check('vehicule_detention_motif_fin_chk', sql`(${t.au} is null) = (${t.motifFin} is null)`),
    index('vehicule_detention_courante_idx').on(t.tenantId, t.vehiculeId),
    index('vehicule_detention_client_idx').on(t.tenantId, t.clientId, t.du.desc()),
  ],
);

/** Append-only (RM-23/24/25) : pas de `modifie_le`. `valeur_km` est GENERATED — non modélisée
 *  côté Drizzle (colonne calculée en base, exposée en lecture via `$type` sur `integer`). */
export const vehiculeKilometrage = pgTable(
  'vehicule_kilometrage',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    vehiculeId: uuid('vehicule_id').notNull(),
    valeur: integer('valeur').notNull(),
    unite: uniteDistanceEnum('unite').notNull(),
    releveLe: timestamp('releve_le', { withTimezone: true, mode: 'date' }).notNull(),
    source: sourceKilometrageEnum('source').notNull(),
    motifRegression: motifKilometrageRegressifEnum('motif_regression'),
    /** FK ajoutée par migrations/0008_atelier.sql, une fois `ordre_reparation` créé. */
    ordreReparationId: uuid('ordre_reparation_id'),
    saisiParId: uuid('saisi_par_id'),
    valeurKm: integer('valeur_km'),
    creeLe: colonneCreeLe(),
  },
  (t) => [
    unique('vehicule_kilometrage_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'vehicule_kilometrage_fk_vehicule',
      columns: [t.tenantId, t.vehiculeId],
      foreignColumns: [vehicule.tenantId, vehicule.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'vehicule_kilometrage_fk_saisi_par',
      columns: [t.tenantId, t.saisiParId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),
    check('vehicule_kilometrage_valeur_chk', sql`${t.valeur} >= 0`),
    index('vehicule_kilometrage_dernier_idx').on(t.tenantId, t.vehiculeId, t.releveLe.desc()),
  ],
);

export const vehiculeExpertise = pgTable(
  'vehicule_expertise',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    vehiculeId: uuid('vehicule_id').notNull(),
    dateExpertise: date('date_expertise').notNull(),
    resultat: resultatExpertiseEnum('resultat').notNull(),
    defauts: text('defauts'),
    delaiContreVisite: date('delai_contre_visite'),
    dateContreVisite: date('date_contre_visite'),
    prochaineEcheance: date('prochaine_echeance'),
    sourceEcheance: sourceEcheanceExpertiseEnum('source_echeance'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('vehicule_expertise_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'vehicule_expertise_fk',
      columns: [t.tenantId, t.vehiculeId],
      foreignColumns: [vehicule.tenantId, vehicule.id],
    }).onDelete('restrict'),
    index('vehicule_expertise_echeance_idx').on(t.tenantId, t.prochaineEcheance),
  ],
);

export const vehiculeCampagne = pgTable(
  'vehicule_campagne',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    vehiculeId: uuid('vehicule_id').notNull(),
    code: text('code').notNull(),
    description: text('description'),
    obligatoire: boolean('obligatoire').notNull().default(false),
    statut: statutCampagneEnum('statut').notNull().default('ouverte'),
    closeLe: timestamp('close_le', { withTimezone: true, mode: 'date' }),
    /** FK ajoutée par migrations/0008_atelier.sql. */
    ordreReparationId: uuid('ordre_reparation_id'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('vehicule_campagne_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'vehicule_campagne_fk',
      columns: [t.tenantId, t.vehiculeId],
      foreignColumns: [vehicule.tenantId, vehicule.id],
    }).onDelete('restrict'),
    check('vehicule_campagne_code_non_vide_chk', sql`length(btrim(${t.code})) > 0`),
    index('vehicule_campagne_ouverte_idx').on(t.tenantId, t.vehiculeId),
  ],
);

export const vehiculeTravailReporte = pgTable(
  'vehicule_travail_reporte',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    vehiculeId: uuid('vehicule_id').notNull(),
    designation: text('designation').notNull(),
    urgence: urgenceTravailEnum('urgence').notNull(),
    montantEstimeCentimes: integer('montant_estime_centimes'),
    kmConstat: integer('km_constat'),
    dateConstat: date('date_constat').notNull(),
    /** FK ajoutées par migrations/0008_atelier.sql. */
    ordreReparationOrigineId: uuid('ordre_reparation_origine_id'),
    ligneOrOrigineId: uuid('ligne_or_origine_id'),
    securite: boolean('securite').notNull().default(false),
    statut: statutTravailReporteEnum('statut').notNull().default('ouvert'),
    ordreReparationRepriseId: uuid('ordre_reparation_reprise_id'),
    /** Raison du refus saisie au comptoir (0021, RM-73) — nullable, sans borne de longueur
     * (voir la migration : aucun champ de texte libre de ce dépôt n'en a). Consultée au passage
     * suivant. DEPUIS 0033 : `vehicule_travail_reporte` est auditée (trigger
     * `vehicule_travail_reporte_audit`) — `motif_refus` reste donc la valeur COURANTE, mais son
     * historique de modification (qui/quand/avant/après) est désormais dans `audit_atelier`. */
    motifRefus: text('motif_refus'),
    /** Raison d'une correction ou d'un abandon ULTÉRIEUR (0033, RM-73) — distincte de
     * `motifRefus` (autre moment : au refus initial du devis / à une modification plus tard ;
     * autre acteur potentiellement). Voir l'arbitrage complet en tête de la migration 0033 :
     * NE JAMAIS fusionner avec `motifRefus`, ce serait perdre la traçabilité du refus initial que
     * 0021 avait posée pour préserver. Même forme exacte que `motifRefus` : nullable, sans borne
     * de longueur, gardée par une contrainte CHECK de non-vacuité quand renseignée. Alimentée par
     * `ServiceVehiculeTravailReporte.modifier` (`entree.motif`, `schemaModificationTravailReporte`
     * — normalisation défensive `.trim() || null` avant écriture, même doctrine que
     * `creerDepuisRefus`/`motifRefus`). */
    motifModification: text('motif_modification'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('vehicule_travail_reporte_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'vehicule_travail_reporte_fk',
      columns: [t.tenantId, t.vehiculeId],
      foreignColumns: [vehicule.tenantId, vehicule.id],
    }).onDelete('restrict'),
    check(
      'vehicule_travail_reporte_designation_non_vide_chk',
      sql`length(btrim(${t.designation})) > 0`,
    ),
    check(
      'vehicule_travail_reporte_motif_refus_non_vide_chk',
      sql`${t.motifRefus} is null or length(btrim(${t.motifRefus})) > 0`,
    ),
    check(
      'vehicule_travail_reporte_motif_modification_non_vide_chk',
      sql`${t.motifModification} is null or length(btrim(${t.motifModification})) > 0`,
    ),
    index('vehicule_travail_reporte_ouvert_idx').on(t.tenantId, t.vehiculeId),
  ],
);

export type LigneVehicule = typeof vehicule.$inferSelect;
export type NouveauVehicule = typeof vehicule.$inferInsert;
export type LigneVehiculePlaque = typeof vehiculePlaque.$inferSelect;
export type LigneVehiculeDetention = typeof vehiculeDetention.$inferSelect;
export type LigneVehiculeKilometrage = typeof vehiculeKilometrage.$inferSelect;
export type LigneVehiculeExpertise = typeof vehiculeExpertise.$inferSelect;
export type LigneVehiculeCampagne = typeof vehiculeCampagne.$inferSelect;
export type LigneVehiculeTravailReporte = typeof vehiculeTravailReporte.$inferSelect;
