/**
 * Module clients — `client`, `client_adresse`, `client_contact`, `client_condition`,
 * `client_consentement`, `client_note`. Détail des règles : migrations/0006_clients.sql.
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
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  colonnesHorodatage,
  colonneCreeLe,
  colonneId,
  colonneTenantId,
} from '../colonnes-communes';
import { langueEnum } from '../enums';
// Import direct du fichier (pas du barrel '../facturation') : même précaution que
// atelier/ordre-reparation.ts (Z-17, 0011) — enums.ts n'importe rien d'atelier, ce chemin
// direct est sûr et évite tout risque de cycle avec le barrel facturation/index.ts.
import { origineDocumentEnum } from '../facturation/enums';
import { tenant } from '../tenant';
import { utilisateur } from '../utilisateur';
import {
  natureNoteEnum,
  roleContactEnum,
  statutClientEnum,
  typeAdresseEnum,
  typeClientEnum,
  typeConsentementEnum,
} from './enums';

export const client = pgTable(
  'client',
  {
    id: colonneId(),
    tenantId: colonneTenantId().references(() => tenant.id, { onDelete: 'restrict' }),
    numero: text('numero').notNull(),
    /**
     * Reprise (migrations/0066_ancrages_origine_reprise.sql) : même enum et même sémantique que
     * documentVente.origine (0010) et ordreReparation.origine (0011) — dfa (créé par DFA) ou
     * reprise (importé).
     */
    origine: origineDocumentEnum('origine').notNull().default('dfa'),
    /** Reprise (0066) : numéro/identifiant client source verbatim, jamais retouché. NULL si
     * origine=dfa. */
    numeroOrigine: text('numero_origine'),
    type: typeClientEnum('type').notNull(),
    civilite: text('civilite'),
    nom: text('nom'),
    prenom: text('prenom'),
    raisonSociale: text('raison_sociale'),
    ide: text('ide'),
    langue: langueEnum('langue').notNull(),
    email: text('email'),
    telephone: text('telephone'),
    telephoneE164: text('telephone_e164'),
    canalPrefere: text('canal_prefere'),
    statut: statutClientEnum('statut').notNull().default('actif'),
    poObligatoire: boolean('po_obligatoire').notNull().default(false),
    groupeClientId: uuid('groupe_client_id'),
    fusionneVersClientId: uuid('fusionne_vers_client_id'),
    referenceExterne: text('reference_externe'),
    /**
     * RA-14 (migration 0045) : « arrêt de tout contact » — plus fort que tout consentement
     * marketing (`clientConsentement` ci-dessous), lu par le job de relances AVANT tout envoi, y
     * compris pour une facture impayée où aucun consentement marketing n'est pourtant requis.
     * Colonnes posées par 0045, mapping Drizzle ajouté ICI (propriétaire du module clients) — la
     * migration elle-même ne pouvait pas toucher ce fichier (hors de son périmètre d'écriture),
     * voir l'en-tête §D de `db/migrations/0045_relances_socle.sql`. Écrites exclusivement par les
     * deux gestes dédiés `POST /clients/{id}/arreter-contact` et `.../reprendre-contact`
     * (`clients/service-client.ts`) — jamais par le `PATCH` générique de la fiche, au même titre
     * que `statut` (désactivation) : un booléen à conséquence légale mérite sa propre route
     * traçable, pas un champ parmi d'autres d'un corps `PATCH` libre.
     */
    plusAucunContact: boolean('plus_aucun_contact').notNull().default(false),
    /**
     * Motif de `plusAucunContact` — requis dès que le drapeau est posé (CHECK ci-dessous, miroir
     * exact de `client_plus_aucun_contact_motif_chk`, 0045). Sans rapport avec `clientNote`
     * (notes internes libres) : ce champ documente spécifiquement la décision RA-14, et reste la
     * valeur COURANTE (pas un historique — voir `clientConsentement` pour le patron append-only,
     * délibérément écarté ici par 0045 : « pas de table séparée pour RA-14 »).
     */
    motif: text('motif'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('client_tenant_id_uk').on(t.tenantId, t.id),
    unique('client_tenant_numero_uk').on(t.tenantId, t.numero),
    foreignKey({
      name: 'client_fk_groupe',
      columns: [t.tenantId, t.groupeClientId],
      foreignColumns: [t.tenantId, t.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'client_fk_fusionne_vers',
      columns: [t.tenantId, t.fusionneVersClientId],
      foreignColumns: [t.tenantId, t.id],
    }).onDelete('restrict'),
    check('client_numero_non_vide_chk', sql`length(btrim(${t.numero})) > 0`),
    check(
      'client_identite_chk',
      sql`(${t.type} = 'particulier' and ${t.nom} is not null) or (${t.type} = 'entreprise' and ${t.raisonSociale} is not null)`,
    ),
    check(
      'client_telephone_e164_chk',
      sql`${t.telephoneE164} is null or ${t.telephoneE164} ~ '^\+[1-9][0-9]{6,14}$'`,
    ),
    check(
      'client_ide_chk',
      sql`${t.ide} is null or ${t.ide} ~ '^CHE-[0-9]{3}\.[0-9]{3}\.[0-9]{3}$'`,
    ),
    check(
      'client_fusionne_inactif_chk',
      sql`${t.fusionneVersClientId} is null or ${t.statut} = 'inactif'`,
    ),
    check(
      'client_plus_aucun_contact_motif_chk',
      sql`not ${t.plusAucunContact} or ${t.motif} is not null`,
    ),
    // Reprise (0066) : même patron que ordre_reparation_origine_numero_origine_chk (0011).
    check(
      'client_origine_numero_origine_chk',
      sql`(${t.origine} = 'dfa') = (${t.numeroOrigine} is null)`,
    ),
    // client_numero_origine_uk (index unique PARTIEL, where numero_origine is not null — 0066)
    // n'est pas modélisable via `unique()` de pg-core (pas de clause WHERE) : posé en SQL brut,
    // même limite que ordre_reparation_numero_origine_uk (0011).
  ],
);

export const clientAdresse = pgTable(
  'client_adresse',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    type: typeAdresseEnum('type').notNull(),
    rue: text('rue'),
    /**
     * Numéro de rue séparé (migration 0014), requis pour le bloc débiteur du QR-facture
     * (RF-60) mais NULLABLE à dessein — case postale/lieu-dit/hameau n'en ont pas. Aucune
     * reprise automatique depuis `rue` pour les adresses existantes : voir 0014 en tête de
     * fichier.
     */
    numero: text('numero'),
    complement: text('complement'),
    npa: text('npa'),
    localite: text('localite'),
    pays: char('pays', { length: 2 }).notNull().default('CH'),
    actif: boolean('actif').notNull().default(true),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('client_adresse_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'client_adresse_fk',
      columns: [t.tenantId, t.clientId],
      foreignColumns: [client.tenantId, client.id],
    }).onDelete('restrict'),
  ],
);

export const clientContact = pgTable(
  'client_contact',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    nom: text('nom'),
    prenom: text('prenom'),
    fonction: text('fonction'),
    telephone: text('telephone'),
    telephoneE164: text('telephone_e164'),
    email: text('email'),
    langue: langueEnum('langue'),
    roles: roleContactEnum('roles').array().notNull(),
    actif: boolean('actif').notNull().default(true),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('client_contact_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'client_contact_fk',
      columns: [t.tenantId, t.clientId],
      foreignColumns: [client.tenantId, client.id],
    }).onDelete('restrict'),
    check('client_contact_roles_non_vide_chk', sql`cardinality(${t.roles}) > 0`),
  ],
);

export const clientCondition = pgTable(
  'client_condition',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    rabaisMoPourmille: smallint('rabais_mo_pourmille'),
    rabaisPiecesPourmille: smallint('rabais_pieces_pourmille'),
    rabaisPneusPourmille: smallint('rabais_pneus_pourmille'),
    tauxHoraireCode: text('taux_horaire_code'),
    delaiPaiementJours: smallint('delai_paiement_jours'),
    modePaiement: text('mode_paiement'),
    plafondCentimes: integer('plafond_centimes'),
    valideDu: date('valide_du').notNull(),
    valideAu: date('valide_au'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('client_condition_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'client_condition_fk',
      columns: [t.tenantId, t.clientId],
      foreignColumns: [client.tenantId, client.id],
    }).onDelete('restrict'),
  ],
);

/** Append-only (RM-09, nLPD) : pas de `modifie_le`, une ligne ne se modifie jamais. */
export const clientConsentement = pgTable(
  'client_consentement',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    type: typeConsentementEnum('type').notNull(),
    accorde: boolean('accorde').notNull(),
    recueilliLe: timestamp('recueilli_le', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    canal: text('canal'),
    preuve: jsonb('preuve'),
    creeLe: colonneCreeLe(),
  },
  (t) => [
    unique('client_consentement_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'client_consentement_fk',
      columns: [t.tenantId, t.clientId],
      foreignColumns: [client.tenantId, client.id],
    }).onDelete('restrict'),
  ],
);

export const clientNote = pgTable(
  'client_note',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    nature: natureNoteEnum('nature').notNull().default('interne'),
    texte: text('texte').notNull(),
    auteurId: uuid('auteur_id'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('client_note_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'client_note_fk',
      columns: [t.tenantId, t.clientId],
      foreignColumns: [client.tenantId, client.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'client_note_fk_auteur',
      columns: [t.tenantId, t.auteurId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),
    check('client_note_texte_non_vide_chk', sql`length(btrim(${t.texte})) > 0`),
  ],
);

export type LigneClient = typeof client.$inferSelect;
export type NouveauClient = typeof client.$inferInsert;
export type LigneClientAdresse = typeof clientAdresse.$inferSelect;
export type LigneClientContact = typeof clientContact.$inferSelect;
export type LigneClientCondition = typeof clientCondition.$inferSelect;
export type LigneClientConsentement = typeof clientConsentement.$inferSelect;
export type LigneClientNote = typeof clientNote.$inferSelect;
