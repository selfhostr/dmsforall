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

import { colonnesHorodatage, colonneCreeLe, colonneId, colonneTenantId } from '../colonnes-communes';
import { langueEnum } from '../enums';
import { tenant } from '../tenant';
import { utilisateur } from '../utilisateur';
import { natureNoteEnum, roleContactEnum, statutClientEnum, typeAdresseEnum, typeClientEnum, typeConsentementEnum } from './enums';

export const client = pgTable(
  'client',
  {
    id: colonneId(),
    tenantId: colonneTenantId().references(() => tenant.id, { onDelete: 'restrict' }),
    numero: text('numero').notNull(),
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
    check('client_ide_chk', sql`${t.ide} is null or ${t.ide} ~ '^CHE-[0-9]{3}\.[0-9]{3}\.[0-9]{3}$'`),
    check(
      'client_fusionne_inactif_chk',
      sql`${t.fusionneVersClientId} is null or ${t.statut} = 'inactif'`,
    ),
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
    recueilliLe: timestamp('recueilli_le', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
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
