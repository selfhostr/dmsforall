/**
 * Module paramétrage — `parametre_atelier`, `parametre_site`, `compteur_document`,
 * `taux_horaire`, `prestation`/`prestation_prix`, `motif_rendez_vous`, `poste_travail`,
 * `activite_indirecte`. Détail des règles : migrations/0005_parametrage.sql.
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  time,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { colonnesHorodatage, colonneId, colonneTenantId } from '../colonnes-communes';
import { site } from '../site';
import { tenant } from '../tenant';
import {
  arrondiPointageEnum,
  modeIdentificationPointageEnum,
  politiqueControleQualiteEnum,
  politiqueDemontageRefuseEnum,
  politiqueDeuxOrMemeVehiculeEnum,
  politiqueLangueDocumentEnum,
  politiqueMentionSecuriteEnum,
  politiqueSignatureReceptionEnum,
  porteeNumerotationEnum,
  typeLigneOrEnum,
  uniteTempsEnum,
  visibiliteHistoriqueVehiculeEnum,
} from './enums';

/** Une ligne par tenant — PK confondue avec `tenant_id`. */
export const parametreAtelier = pgTable('parametre_atelier', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenant.id, { onDelete: 'restrict' }),

  orPrefixe: text('or_prefixe'),
  orPorteeNumerotation: porteeNumerotationEnum('or_portee_numerotation')
    .notNull()
    .default('tenant'),
  orResetAnnuel: boolean('or_reset_annuel').notNull().default(true),
  uniteTemps: uniteTempsEnum('unite_temps').notNull().default('heures_decimales'),

  /** Δ1/Q-02 : NULL = aucun plafond convenu, 0 = accord requis pour tout, n>0 = plafond nominal. */
  plafondDefautCentimes: integer('plafond_defaut_centimes'),

  /**
   * `RF-117` (0018) : plafond d'émission d'avoir par un `receptionnaire` seul — au-delà,
   * direction/comptable prennent le relais (matrice-droits.ts, EMISSION_AVOIR). Même sémantique
   * que `plafondDefautCentimes` : NULL = aucun plafond convenu (défaut, comportement actuel
   * préservé — dégradé documenté), 0 = toute émission doit escalader, n>0 = plafond nominal.
   * Colonne seule : ne plafonne rien tant que le service d'émission d'avoir
   * (`facturation/documents/`) ne la consulte pas.
   */
  plafondAvoirReceptionnaireCentimes: integer('plafond_avoir_receptionnaire_centimes'),

  chevauchementPointageAutorise: boolean('chevauchement_pointage_autorise')
    .notNull()
    .default(false),
  pointageObligatoirePourTerminer: boolean('pointage_obligatoire_pour_terminer')
    .notNull()
    .default(false),
  /** Δ3 : type PG complet (4 valeurs), CHECK restreint à jamais|toujours au lot 1. */
  controleQualite: politiqueControleQualiteEnum('controle_qualite').notNull().default('jamais'),
  signatureReception: politiqueSignatureReceptionEnum('signature_reception')
    .notNull()
    .default('recommandee'),
  kmEntreeObligatoire: boolean('km_entree_obligatoire').notNull().default(true),
  kmSortieObligatoire: boolean('km_sortie_obligatoire').notNull().default(false),
  restitutionAvantPaiement: boolean('restitution_avant_paiement').notNull().default(true),
  multiPayeursAutorise: boolean('multi_payeurs_autorise').notNull().default(false),
  arrondiPointage: arrondiPointageEnum('arrondi_pointage').notNull().default('quart'),
  orSansRdvAutorise: boolean('or_sans_rdv_autorise').notNull().default(true),
  rdvRetroactifAuto: boolean('rdv_retroactif_auto').notNull().default(false),
  etatPlanifieActif: boolean('etat_planifie_actif').notNull().default(false),
  langueDocuments: politiqueLangueDocumentEnum('langue_documents').notNull().default('client'),
  politiqueDemontageRefuse: politiqueDemontageRefuseEnum('politique_demontage_refuse')
    .notNull()
    .default('offrir'),
  visibiliteHistoriqueNouveauDetenteur: visibiliteHistoriqueVehiculeEnum(
    'visibilite_historique_nouveau_detenteur',
  )
    .notNull()
    .default('technique'),
  /** P-27 : « A » ou « B », pas de source `@dfa/shared` — contraint en dur (voir migration). */
  attentePiecesLongueDefaut: char('attente_pieces_longue_defaut', { length: 1 })
    .notNull()
    .default('A'),
  mentionSecurite: politiqueMentionSecuriteEnum('mention_securite')
    .notNull()
    .default('obligatoire'),
  deuxOrMemeVehicule: politiqueDeuxOrMemeVehiculeEnum('deux_or_meme_vehicule')
    .notNull()
    .default('avertir'),
  expertiseAlerteMois: smallint('expertise_alerte_mois').notNull().default(2),
  noShowSeuilAlerte: smallint('no_show_seuil_alerte').notNull().default(2),
  blocageJoursAlerte: smallint('blocage_jours_alerte').notNull().default(3),
  pointageDureeMaxHeures: smallint('pointage_duree_max_heures').notNull().default(12),
  tamponPretMinutes: smallint('tampon_pret_minutes').notNull().default(30),

  produitsAtelier: jsonb('produits_atelier').notNull().default({}),
  rabaisMaxParRole: jsonb('rabais_max_par_role').notNull().default({}),
  periodicitesExpertise: jsonb('periodicites_expertise').notNull().default({}),
  relanceNonRetire: jsonb('relance_non_retire').notNull().default({}),

  ...colonnesHorodatage(),
});

/** Une ligne par site — PK confondue avec `site_id`. */
export const parametreSite = pgTable(
  'parametre_site',
  {
    tenantId: uuid('tenant_id').notNull(),
    siteId: uuid('site_id').primaryKey(),
    heureOuverture: time('heure_ouverture'),
    heureFermeture: time('heure_fermeture'),
    heureCloturePointage: time('heure_cloture_pointage'),
    capaciteHeuresJourCentiemes: integer('capacite_heures_jour_centiemes'),
    joursFermeture: jsonb('jours_fermeture').notNull().default([]),
    /**
     * RM-124 (0036, `docs/specification-pointage-borne.md`) : mode d'identification du pointage
     * pour ce site. Défaut `'session_personnelle'` impératif — tous les sites existants
     * continuent de fonctionner à l'identique sans intervention. Même droit que les autres
     * colonnes de cet enregistrement (`parametrage.atelier.modifier`), via le même endpoint
     * `PATCH /sites/{siteId}/parametres-atelier` déjà en place.
     */
    modeIdentificationPointage: modeIdentificationPointageEnum('mode_identification_pointage')
      .notNull()
      .default('session_personnelle'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('parametre_site_tenant_id_uk').on(t.tenantId, t.siteId),
    foreignKey({
      name: 'parametre_site_fk',
      columns: [t.tenantId, t.siteId],
      foreignColumns: [site.tenantId, site.id],
    }).onDelete('restrict'),
  ],
);

export const compteurDocument = pgTable(
  'compteur_document',
  {
    id: colonneId(),
    tenantId: colonneTenantId().references(() => tenant.id, { onDelete: 'restrict' }),
    typeDocument: text('type_document').notNull(),
    annee: smallint('annee').notNull(),
    siteId: uuid('site_id'),
    valeur: integer('valeur').notNull().default(0),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('compteur_document_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'compteur_document_fk_site',
      columns: [t.tenantId, t.siteId],
      foreignColumns: [site.tenantId, site.id],
    }).onDelete('restrict'),
    check('compteur_document_annee_chk', sql`${t.annee} between 2000 and 2100`),
    check('compteur_document_valeur_chk', sql`${t.valeur} >= 0`),
    // L'unicité réelle est portée par un index d'expression (coalesce du site_id), posé en SQL
    // brut (migrations/0005) : Drizzle ne modélise pas d'index sur expression ici.
  ],
);

export const tauxHoraire = pgTable(
  'taux_horaire',
  {
    id: colonneId(),
    tenantId: colonneTenantId().references(() => tenant.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    libelle: text('libelle').notNull(),
    montantCentimes: integer('montant_centimes').notNull(),
    valideDu: date('valide_du').notNull(),
    valideAu: date('valide_au'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('taux_horaire_tenant_id_uk').on(t.tenantId, t.id),
    check('taux_horaire_montant_chk', sql`${t.montantCentimes} between 0 and 100000000`),
    // EXCLUDE GiST posée en SQL brut (btree_gist, daterange) — non exprimable via Drizzle pg-core.
  ],
);

export const prestation = pgTable(
  'prestation',
  {
    id: colonneId(),
    tenantId: colonneTenantId().references(() => tenant.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    designationFr: text('designation_fr').notNull(),
    designationDe: text('designation_de'),
    designationIt: text('designation_it'),
    typeLigne: typeLigneOrEnum('type_ligne').notNull().default('forfait'),
    tempsBaremeCentiemes: integer('temps_bareme_centiemes'),
    tauxHoraireCode: text('taux_horaire_code'),
    tauxTvaPourmille: smallint('taux_tva_pourmille').notNull().default(81),
    actif: boolean('actif').notNull().default(true),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('prestation_tenant_id_uk').on(t.tenantId, t.id),
    unique('prestation_tenant_code_uk').on(t.tenantId, t.code),
    check('prestation_taux_tva_chk', sql`${t.tauxTvaPourmille} between 0 and 1000`),
  ],
);

export const prestationPrix = pgTable(
  'prestation_prix',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    prestationId: uuid('prestation_id').notNull(),
    prixCentimes: integer('prix_centimes').notNull(),
    valideDu: date('valide_du').notNull(),
    valideAu: date('valide_au'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('prestation_prix_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'prestation_prix_fk',
      columns: [t.tenantId, t.prestationId],
      foreignColumns: [prestation.tenantId, prestation.id],
    }).onDelete('restrict'),
    check('prestation_prix_montant_chk', sql`${t.prixCentimes} between 0 and 100000000`),
  ],
);

export const motifRendezVous = pgTable(
  'motif_rendez_vous',
  {
    id: colonneId(),
    tenantId: colonneTenantId().references(() => tenant.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    libelleFr: text('libelle_fr').notNull(),
    libelleDe: text('libelle_de'),
    libelleIt: text('libelle_it'),
    dureeDefautMinutes: smallint('duree_defaut_minutes'),
    heuresAtelierDefautCentiemes: integer('heures_atelier_defaut_centiemes'),
    actif: boolean('actif').notNull().default(true),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('motif_rendez_vous_tenant_id_uk').on(t.tenantId, t.id),
    unique('motif_rendez_vous_tenant_code_uk').on(t.tenantId, t.code),
  ],
);

export const posteTravail = pgTable(
  'poste_travail',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    siteId: uuid('site_id').notNull(),
    code: text('code').notNull(),
    libelle: text('libelle').notNull(),
    actif: boolean('actif').notNull().default(true),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('poste_travail_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'poste_travail_fk_site',
      columns: [t.tenantId, t.siteId],
      foreignColumns: [site.tenantId, site.id],
    }).onDelete('restrict'),
    unique('poste_travail_tenant_site_code_uk').on(t.tenantId, t.siteId, t.code),
  ],
);

export const activiteIndirecte = pgTable(
  'activite_indirecte',
  {
    id: colonneId(),
    tenantId: colonneTenantId().references(() => tenant.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    libelleFr: text('libelle_fr').notNull(),
    libelleDe: text('libelle_de'),
    libelleIt: text('libelle_it'),
    productif: boolean('productif').notNull().default(false),
    actif: boolean('actif').notNull().default(true),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('activite_indirecte_tenant_id_uk').on(t.tenantId, t.id),
    unique('activite_indirecte_tenant_code_uk').on(t.tenantId, t.code),
  ],
);

export type LigneParametreAtelier = typeof parametreAtelier.$inferSelect;
export type LigneParametreSite = typeof parametreSite.$inferSelect;
export type LigneCompteurDocument = typeof compteurDocument.$inferSelect;
export type LigneTauxHoraire = typeof tauxHoraire.$inferSelect;
export type LignePrestation = typeof prestation.$inferSelect;
export type LignePrestationPrix = typeof prestationPrix.$inferSelect;
export type LigneMotifRendezVous = typeof motifRendezVous.$inferSelect;
export type LignePosteTravail = typeof posteTravail.$inferSelect;
export type LigneActiviteIndirecte = typeof activiteIndirecte.$inferSelect;
