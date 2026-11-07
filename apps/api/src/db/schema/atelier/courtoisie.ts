/**
 * `vehicule_courtoisie` (parc du garage) et `pret_courtoisie` (prêts aux clients) — migration
 * 0081_courtoisie.sql. La contrainte d'exclusion anti-chevauchement des prêts actifs
 * (`pret_courtoisie_pas_de_chevauchement`, EXCLUDE gist) n'est pas exprimable en Drizzle : elle vit
 * dans la migration seule.
 */

import {
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { colonnesHorodatage, colonneId } from '../colonnes-communes';
import { utilisateur } from '../utilisateur';
import { client } from './client';
import { etatVehiculeCourtoisieEnum, statutPretCourtoisieEnum } from './enums';
import { ordreReparation } from './ordre-reparation';
import { rendezVous } from './rendez-vous';

export const vehiculeCourtoisie = pgTable(
  'vehicule_courtoisie',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    designation: text('designation').notNull(),
    plaque: text('plaque'),
    kilometrage: integer('kilometrage'),
    /** Indisponibilité administrative seulement (jamais `prete`, voir le CHECK de la migration). */
    etat: etatVehiculeCourtoisieEnum('etat').notNull().default('disponible'),
    note: text('note'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('vehicule_courtoisie_tenant_id_uk').on(t.tenantId, t.id),
    index('vehicule_courtoisie_pagination_idx').on(t.tenantId, t.designation, t.id),
  ],
);

export const pretCourtoisie = pgTable(
  'pret_courtoisie',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    vehiculeCourtoisieId: uuid('vehicule_courtoisie_id').notNull(),
    clientId: uuid('client_id').notNull(),
    ordreReparationId: uuid('ordre_reparation_id'),
    rendezVousId: uuid('rendez_vous_id'),
    debutLe: timestamp('debut_le', { withTimezone: true, mode: 'date' }).notNull(),
    finPrevueLe: timestamp('fin_prevue_le', { withTimezone: true, mode: 'date' }).notNull(),
    renduLe: timestamp('rendu_le', { withTimezone: true, mode: 'date' }),
    kmDepart: integer('km_depart'),
    kmRetour: integer('km_retour'),
    statut: statutPretCourtoisieEnum('statut').notNull().default('en_cours'),
    note: text('note'),
    creeParId: uuid('cree_par_id'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('pret_courtoisie_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'pret_courtoisie_fk_vehicule',
      columns: [t.tenantId, t.vehiculeCourtoisieId],
      foreignColumns: [vehiculeCourtoisie.tenantId, vehiculeCourtoisie.id],
    }),
    foreignKey({
      name: 'pret_courtoisie_fk_client',
      columns: [t.tenantId, t.clientId],
      foreignColumns: [client.tenantId, client.id],
    }),
    foreignKey({
      name: 'pret_courtoisie_fk_or',
      columns: [t.tenantId, t.ordreReparationId],
      foreignColumns: [ordreReparation.tenantId, ordreReparation.id],
    }),
    foreignKey({
      name: 'pret_courtoisie_fk_rdv',
      columns: [t.tenantId, t.rendezVousId],
      foreignColumns: [rendezVous.tenantId, rendezVous.id],
    }),
    foreignKey({
      name: 'pret_courtoisie_fk_cree_par',
      columns: [t.tenantId, t.creeParId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }),
    index('pret_courtoisie_vehicule_idx').on(t.tenantId, t.vehiculeCourtoisieId, t.debutLe),
    index('pret_courtoisie_client_idx').on(t.tenantId, t.clientId, t.debutLe),
    index('pret_courtoisie_pagination_idx').on(t.tenantId, t.creeLe, t.id),
  ],
);

export type LigneVehiculeCourtoisie = typeof vehiculeCourtoisie.$inferSelect;
export type LignePretCourtoisie = typeof pretCourtoisie.$inferSelect;
