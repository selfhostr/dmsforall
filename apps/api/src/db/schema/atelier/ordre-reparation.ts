/**
 * Module atelier — `ordre_reparation`, `ordre_reparation_demande`, `ligne_or`,
 * `devis_complementaire`, `devis_complementaire_ligne`, `or_controle_qualite`.
 * Détail des règles, triggers et deltas (Δ1/Δ2) : migrations/0008_atelier.sql.
 */

import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { colonneCreeLe, colonnesHorodatage, colonneId } from '../colonnes-communes';
// Import direct du fichier (pas du barrel '../facturation') : le barrel réexporte
// document-vente.ts, qui importe ordreReparation/ligneOr depuis CE fichier — passer par le
// barrel créerait un cycle d'import. enums.ts n'importe rien d'atelier, donc ce chemin direct est
// sûr (Z-17, migrations/0011_ordre_reparation_origine_reprise.sql).
import { origineDocumentEnum } from '../facturation/enums';
import { site } from '../site';
import { utilisateur } from '../utilisateur';
import { client } from './client';
import {
  blocageLigneOrEnum,
  canalDevisEnum,
  decisionDevisEnum,
  localisationVehiculeEnum,
  motifLienOrEnum,
  origineLigneOrEnum,
  payeurLigneOrEnum,
  statutLigneOrEnum,
  statutOrdreReparationEnum,
  typeLigneOrEnum,
  typeOrdreReparationEnum,
  urgenceTravailEnum,
} from './enums';
import { vehicule } from './vehicule';

export const ordreReparation = pgTable(
  'ordre_reparation',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    numero: text('numero').notNull(),
    /**
     * Z-17 (migrations/0011_ordre_reparation_origine_reprise.sql) : même enum et même sémantique
     * que `documentVente.origine` (0010) — dfa (créé par DFA) ou reprise (importé).
     */
    origine: origineDocumentEnum('origine').notNull().default('dfa'),
    /** Z-17/MD-04 : numéro source verbatim d'un OR repris, jamais retouché. NULL si origine=dfa. */
    numeroOrigine: text('numero_origine'),
    siteId: uuid('site_id').notNull(),
    type: typeOrdreReparationEnum('type').notNull(),
    statut: statutOrdreReparationEnum('statut').notNull(),
    clientId: uuid('client_id').notNull(),
    vehiculeId: uuid('vehicule_id').notNull(),

    clientDesignationFigee: text('client_designation_figee').notNull(),
    adresseFacturationFigee: jsonb('adresse_facturation_figee').notNull(),
    conditionsFigees: jsonb('conditions_figees').notNull(),
    plaqueFigee: text('plaque_figee'),
    detenteurFigeClientId: uuid('detenteur_fige_client_id'),

    conducteurPresentNom: text('conducteur_present_nom'),
    kmEntree: integer('km_entree'),
    kmSortie: integer('km_sortie'),

    /** Δ1/Q-02 : NULL = aucun plafond convenu, 0 = accord requis pour tout, n>0 = plafond nominal. */
    plafondCentimes: integer('plafond_centimes'),
    plafondAutorisePar: text('plafond_autorise_par'),

    restitutionPromiseLe: timestamp('restitution_promise_le', { withTimezone: true, mode: 'date' }),
    restitutionInitialeLe: timestamp('restitution_initiale_le', {
      withTimezone: true,
      mode: 'date',
    }),

    localisation: localisationVehiculeEnum('localisation').notNull().default('parc'),
    sousTraitantNom: text('sous_traitant_nom'),

    ordreReparationParentId: uuid('ordre_reparation_parent_id'),
    motifLien: motifLienOrEnum('motif_lien'),

    /** Accroche lot 3 (planning) : sans FK, `rendez_vous` n'existe pas au lot 1. */
    rendezVousId: uuid('rendez_vous_id'),

    numeroCommandeInterne: text('numero_commande_interne'),
    receptionnaireId: uuid('receptionnaire_id'),

    retentionInvoqueeLe: timestamp('retention_invoquee_le', { withTimezone: true, mode: 'date' }),
    litigeOuvertLe: timestamp('litige_ouvert_le', { withTimezone: true, mode: 'date' }),

    ouvertLe: timestamp('ouvert_le', { withTimezone: true, mode: 'date' }),
    termineLe: timestamp('termine_le', { withTimezone: true, mode: 'date' }),
    factureLe: timestamp('facture_le', { withTimezone: true, mode: 'date' }),
    restitueLe: timestamp('restitue_le', { withTimezone: true, mode: 'date' }),
    clotureLe: timestamp('cloture_le', { withTimezone: true, mode: 'date' }),
    annuleLe: timestamp('annule_le', { withTimezone: true, mode: 'date' }),
    motifAnnulation: text('motif_annulation'),

    /** Couche 5 (drapeaux dérivés, A-03) : maintenus par trigger, jamais écrits par le service. */
    attenteAccord: boolean('attente_accord').notNull().default(false),
    attentePieces: boolean('attente_pieces').notNull().default(false),
    attenteExterne: boolean('attente_externe').notNull().default(false),
    totalValideCentimes: bigint('total_valide_centimes', { mode: 'number' }).notNull().default(0),

    /** Δ2/§1.5 : portée de l'ETag = colonnes d'en-tête seulement, voir le trigger dédié. */
    version: integer('version').notNull().default(1),

    ...colonnesHorodatage(),
  },
  (t) => [
    unique('ordre_reparation_tenant_id_uk').on(t.tenantId, t.id),
    unique('ordre_reparation_tenant_numero_uk').on(t.tenantId, t.numero),
    foreignKey({
      name: 'ordre_reparation_fk_site',
      columns: [t.tenantId, t.siteId],
      foreignColumns: [site.tenantId, site.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'ordre_reparation_fk_client',
      columns: [t.tenantId, t.clientId],
      foreignColumns: [client.tenantId, client.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'ordre_reparation_fk_vehicule',
      columns: [t.tenantId, t.vehiculeId],
      foreignColumns: [vehicule.tenantId, vehicule.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'ordre_reparation_fk_detenteur_fige',
      columns: [t.tenantId, t.detenteurFigeClientId],
      foreignColumns: [client.tenantId, client.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'ordre_reparation_fk_parent',
      columns: [t.tenantId, t.ordreReparationParentId],
      foreignColumns: [t.tenantId, t.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'ordre_reparation_fk_receptionnaire',
      columns: [t.tenantId, t.receptionnaireId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),
    check('ordre_reparation_numero_non_vide_chk', sql`length(btrim(${t.numero})) > 0`),
    check(
      'ordre_reparation_lien_coherent_chk',
      sql`(${t.ordreReparationParentId} is null) = (${t.motifLien} is null)`,
    ),
    check(
      'ordre_reparation_annulation_coherente_chk',
      sql`${t.statut} <> 'annule' or ${t.motifAnnulation} is not null`,
    ),
    // Z-17 (0011) : même motif que document_vente (0010) — reprise ⟺ numero_origine renseigné.
    check(
      'ordre_reparation_origine_numero_origine_chk',
      sql`(${t.origine} = 'dfa') = (${t.numeroOrigine} is null)`,
    ),
    index('ordre_reparation_actifs_idx').on(t.tenantId, t.siteId, t.statut),
    index('ordre_reparation_vehicule_idx').on(t.tenantId, t.vehiculeId, t.ouvertLe.desc()),
    index('ordre_reparation_client_idx').on(t.tenantId, t.clientId, t.ouvertLe.desc()),
    index('ordre_reparation_pagination_idx').on(t.tenantId, t.creeLe.desc(), t.id.desc()),
    // ordre_reparation_numero_origine_uk (index unique PARTIEL, where numero_origine is not
    // null — 0011) n'est pas modélisable via `unique()` de pg-core (pas de clause WHERE) : posé
    // en SQL brut, comme les index uniques partiels de document_vente (voir schema/facturation).
  ],
);

/** Append-only (RM-52) : pas de `modifie_le`, le verbatim est un fait. */
export const ordreReparationDemande = pgTable(
  'ordre_reparation_demande',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    ordreReparationId: uuid('ordre_reparation_id').notNull(),
    ordre: smallint('ordre').notNull(),
    verbatim: text('verbatim').notNull(),
    saisiLe: timestamp('saisi_le', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    saisiParId: uuid('saisi_par_id'),
    creeLe: colonneCreeLe(),
  },
  (t) => [
    unique('ordre_reparation_demande_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'ordre_reparation_demande_fk_or',
      columns: [t.tenantId, t.ordreReparationId],
      foreignColumns: [ordreReparation.tenantId, ordreReparation.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'ordre_reparation_demande_fk_saisi_par',
      columns: [t.tenantId, t.saisiParId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),
    unique('ordre_reparation_demande_tenant_or_ordre_uk').on(
      t.tenantId,
      t.ordreReparationId,
      t.ordre,
    ),
    check('ordre_reparation_demande_verbatim_non_vide_chk', sql`length(btrim(${t.verbatim})) > 0`),
  ],
);

export const ligneOr = pgTable(
  'ligne_or',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    ordreReparationId: uuid('ordre_reparation_id').notNull(),
    numeroOrdre: smallint('numero_ordre').notNull(),

    type: typeLigneOrEnum('type').notNull(),
    origine: origineLigneOrEnum('origine').notNull(),
    statut: statutLigneOrEnum('statut').notNull(),
    payeur: payeurLigneOrEnum('payeur').notNull().default('client'),
    blocage: blocageLigneOrEnum('blocage').notNull().default('aucun'),

    designation: text('designation'),
    referenceTexte: text('reference_texte'),
    /** Accroche étape 3 (stock pièces) : sans FK. */
    articleId: uuid('article_id'),

    quantiteMillieme: integer('quantite_millieme').default(1000),
    tempsBaremeCentiemes: integer('temps_bareme_centiemes'),
    tempsBaremeConstructeurCentiemes: integer('temps_bareme_constructeur_centiemes'),

    /** Figés à la création (RM-65). */
    tauxHoraireCentimes: integer('taux_horaire_centimes'),
    prixUnitaireCentimes: integer('prix_unitaire_centimes'),
    rabaisPourmille: smallint('rabais_pourmille'),
    tauxTvaPourmille: smallint('taux_tva_pourmille').notNull().default(81),

    montantHtCentimes: integer('montant_ht_centimes').notNull(),
    montantTvaCentimes: integer('montant_tva_centimes').notNull(),
    montantTtcCentimes: integer('montant_ttc_centimes').notNull(),

    technicienId: uuid('technicien_id'),
    codeOperation: text('code_operation'),
    codeDefaut: text('code_defaut'),
    numeroSinistre: text('numero_sinistre'),
    numeroAccord: text('numero_accord'),

    urgence: urgenceTravailEnum('urgence'),
    securite: boolean('securite').notNull().default(false),
    fourniParClient: boolean('fournie_par_client').notNull().default(false),
    aRestituer: boolean('a_restituer').notNull().default(false),
    restituee: boolean('restituee').notNull().default(false),

    motifAnnulation: text('motif_annulation'),
    /** Accroche étape 2 (facturation) : sans FK. */
    factureId: uuid('facture_id'),

    /**
     * `AC-08` (0017) : désigne le tiers payeur (assurance/constructeur/tiers) quand `payeur`
     * n'est PAS `client`/`garage` — voir `ligne_or_payeur_client_coherent_chk`. Nullable : une
     * ligne peut naître avec `payeur = 'assurance'` avant que l'assureur exact ne soit connu
     * (`MD-65`) ; l'obligation de le renseigner avant émission est un contrôle applicatif, pas
     * une NOT NULL en base (même choix que `tenant_bloc_creancier`, 0014/0016).
     */
    payeurClientId: uuid('payeur_client_id'),

    ...colonnesHorodatage(),
  },
  (t) => [
    unique('ligne_or_tenant_id_uk').on(t.tenantId, t.id),
    unique('ligne_or_tenant_or_ordre_uk').on(t.tenantId, t.ordreReparationId, t.numeroOrdre),
    foreignKey({
      name: 'ligne_or_fk_or',
      columns: [t.tenantId, t.ordreReparationId],
      foreignColumns: [ordreReparation.tenantId, ordreReparation.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'ligne_or_fk_technicien',
      columns: [t.tenantId, t.technicienId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),
    // Composite avec tenant_id (règle n°1 du projet) : une FK sur client.id seul permettrait de
    // désigner le client d'un AUTRE tenant. Même forme que ordre_reparation_fk_client/
    // paiement_fk_payeur.
    foreignKey({
      name: 'ligne_or_fk_payeur_client',
      columns: [t.tenantId, t.payeurClientId],
      foreignColumns: [client.tenantId, client.id],
    }).onDelete('restrict'),
    check(
      'ligne_or_montant_coherent_chk',
      sql`${t.montantTtcCentimes} = ${t.montantHtCentimes} + ${t.montantTvaCentimes}`,
    ),
    check('ligne_or_taux_tva_chk', sql`${t.tauxTvaPourmille} between 0 and 1000`),
    check(
      'ligne_or_annulation_motif_chk',
      sql`${t.statut} <> 'annulee' or ${t.motifAnnulation} is not null`,
    ),
    check(
      'ligne_or_taux_horaire_requis_chk',
      sql`${t.type} not in ('main_oeuvre_bareme', 'main_oeuvre_temps_reel') or ${t.tauxHoraireCentimes} is not null`,
    ),
    // AC-08 (0017) : payeur_client_id ne se renseigne que pour un payeur tiers réel — voir
    // 0017_ligne_or_payeur_client_id.sql §2 pour la justification complète (MD-66 : les lignes
    // payeur=garage sont facturées à personne ; payeur=client désigne implicitement
    // ordre_reparation.client_id).
    check(
      'ligne_or_payeur_client_coherent_chk',
      sql`${t.payeurClientId} is null or ${t.payeur} in ('constructeur', 'assurance', 'tiers')`,
    ),
    index('ligne_or_or_idx').on(t.tenantId, t.ordreReparationId, t.numeroOrdre),
    index('ligne_or_technicien_idx').on(t.tenantId, t.technicienId),
    index('ligne_or_blocage_idx').on(t.tenantId, t.ordreReparationId),
    // Partiel : sert « toutes les lignes d'un payeur tiers donné », inter-OR (ex. relance d'un
    // assureur) — même forme que paiement_payeur_idx (0010). Mesuré (0017) : 11.27 ms → 1.59 ms
    // à 90 000 lignes/tenant.
    index('ligne_or_payeur_client_idx')
      .on(t.tenantId, t.payeurClientId)
      .where(sql`${t.payeurClientId} is not null`),
  ],
);

export const devisComplementaire = pgTable(
  'devis_complementaire',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    ordreReparationId: uuid('ordre_reparation_id').notNull(),
    numeroOrdre: smallint('numero_ordre').notNull(),

    montantTtcCentimes: integer('montant_ttc_centimes').notNull(),
    nouveauPlafondCentimes: integer('nouveau_plafond_centimes'),
    impactRestitutionLe: timestamp('impact_restitution_le', { withTimezone: true, mode: 'date' }),

    envoyeLe: timestamp('envoye_le', { withTimezone: true, mode: 'date' }),
    canal: canalDevisEnum('canal'),
    emetteurId: uuid('emetteur_id'),
    interlocuteurNom: text('interlocuteur_nom'),

    reponduLe: timestamp('repondu_le', { withTimezone: true, mode: 'date' }),
    decision: decisionDevisEnum('decision'),
    retranscription: text('retranscription'),
    preuve: jsonb('preuve'),

    ...colonnesHorodatage(),
  },
  (t) => [
    unique('devis_complementaire_tenant_id_uk').on(t.tenantId, t.id),
    unique('devis_complementaire_tenant_or_ordre_uk').on(
      t.tenantId,
      t.ordreReparationId,
      t.numeroOrdre,
    ),
    foreignKey({
      name: 'devis_complementaire_fk_or',
      columns: [t.tenantId, t.ordreReparationId],
      foreignColumns: [ordreReparation.tenantId, ordreReparation.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'devis_complementaire_fk_emetteur',
      columns: [t.tenantId, t.emetteurId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),
    check(
      'devis_complementaire_reponse_coherente_chk',
      sql`${t.reponduLe} is null or (${t.decision} is not null and ${t.interlocuteurNom} is not null)`,
    ),
  ],
);

export const devisComplementaireLigne = pgTable(
  'devis_complementaire_ligne',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    devisComplementaireId: uuid('devis_complementaire_id').notNull(),
    ligneOrId: uuid('ligne_or_id').notNull(),
    decision: decisionDevisEnum('decision'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('devis_complementaire_ligne_tenant_id_uk').on(t.tenantId, t.id),
    unique('devis_complementaire_ligne_tenant_uk').on(
      t.tenantId,
      t.devisComplementaireId,
      t.ligneOrId,
    ),
    foreignKey({
      name: 'devis_complementaire_ligne_fk_devis',
      columns: [t.tenantId, t.devisComplementaireId],
      foreignColumns: [devisComplementaire.tenantId, devisComplementaire.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'devis_complementaire_ligne_fk_ligne',
      columns: [t.tenantId, t.ligneOrId],
      foreignColumns: [ligneOr.tenantId, ligneOr.id],
    }).onDelete('restrict'),
  ],
);

export const orControleQualite = pgTable(
  'or_controle_qualite',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    ordreReparationId: uuid('ordre_reparation_id').notNull(),
    controleurId: uuid('controleur_id'),
    controleLe: timestamp('controle_le', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    conforme: boolean('conforme').notNull(),
    motifNonConformite: text('motif_non_conformite'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('or_controle_qualite_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'or_controle_qualite_fk_or',
      columns: [t.tenantId, t.ordreReparationId],
      foreignColumns: [ordreReparation.tenantId, ordreReparation.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'or_controle_qualite_fk_controleur',
      columns: [t.tenantId, t.controleurId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),
    check(
      'or_controle_qualite_motif_chk',
      sql`${t.conforme} or ${t.motifNonConformite} is not null`,
    ),
  ],
);

export type LigneOrdreReparation = typeof ordreReparation.$inferSelect;
export type NouvelOrdreReparation = typeof ordreReparation.$inferInsert;
export type LigneOrdreReparationDemande = typeof ordreReparationDemande.$inferSelect;
export type LigneLigneOr = typeof ligneOr.$inferSelect;
export type NouvelleLigneOr = typeof ligneOr.$inferInsert;
export type LigneDevisComplementaire = typeof devisComplementaire.$inferSelect;
export type LigneDevisComplementaireLigne = typeof devisComplementaireLigne.$inferSelect;
export type LigneOrControleQualite = typeof orControleQualite.$inferSelect;
