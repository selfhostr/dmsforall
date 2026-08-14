/**
 * `rendez_vous` — prise de rendez-vous d'atelier. Détail des règles, contraintes et triggers :
 * migrations/0052_rendez_vous_atelier.sql (voir son en-tête pour la collision de noms avec les
 * types `statut_rendez_vous`/`origine_rendez_vous` posés — inutilisés — par 0005_parametrage.sql,
 * et pour les trois arbitrages de @laupernoe appliqués ici).
 *
 * DÉVIATION DE DOCTRINE (même précédent que `modeIdentificationPointageEnum`, `./enums.ts` §0036) :
 * les enums de CE fichier ne sont normalement des `pgEnum(...)` que si leurs valeurs viennent de
 * `@dfa/shared` (SOURCE UNIQUE côté TypeScript). Ici, `packages/shared/src/contrats/` est hors du
 * périmètre d'écriture de cette tâche (propriété de l'agent parallèle sur
 * `apps/api/src/rendezvous/`) — les valeurs sont donc posées EN DUR, à résorber dès qu'un agent
 * peut toucher `packages/shared` : ajouter `STATUTS_PRISE_RENDEZ_VOUS`/`ORIGINES_CREATION_RENDEZ_VOUS`
 * (ou réconcilier avec `StatutRendezVous`/`OrigineRendezVous` existants, voir la migration) dans
 * `contrats/atelier/enums.ts`, les exporter, puis remplacer les tableaux littéraux ci-dessous par
 * ces imports — sans toucher aux noms Postgres ni à la migration 0052, déjà appliquée.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { colonnesHorodatage, colonneId } from '../colonnes-communes';
import { site } from '../site';
import { utilisateur } from '../utilisateur';
import { client } from './client';
import { typeOrdreReparationEnum } from './enums';
import { motifRendezVous } from './parametrage';
import { vehicule } from './vehicule';

/** Miroir migrations/0052 §1. Aucune collision : nom libre. */
export const momentRendezVousEnum = pgEnum('moment_rendez_vous', [
  'matin',
  'apres_midi',
  'toute_journee',
] as const);

/** Miroir migrations/0052 §1 (`statut_prise_rendez_vous`, PAS `statut_rendez_vous` — voir §A de
 *  l'en-tête de la migration). Un seul état actif (`confirme`), trois terminaux. */
export const statutPriseRendezVousEnum = pgEnum('statut_prise_rendez_vous', [
  'confirme',
  'honore',
  'absent',
  'annule',
] as const);

/** Miroir migrations/0052 §1 (`origine_creation_rendez_vous`, PAS `origine_rendez_vous` — voir §A
 *  de l'en-tête de la migration). Réservation vs rétroactif, pas un canal de contact. */
export const origineCreationRendezVousEnum = pgEnum('origine_creation_rendez_vous', [
  'reservation',
  'retroactif',
] as const);

export const rendezVous = pgTable(
  'rendez_vous',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    siteId: uuid('site_id').notNull(),
    clientId: uuid('client_id').notNull(),
    /** Nullable : souvent connu au téléphone, pas toujours — garde applicative avant conversion en
     *  OR (ordre_reparation.vehicule_id est NOT NULL), jamais une contrainte ici. */
    vehiculeId: uuid('vehicule_id'),

    /** §B.2 de la migration : renvoi obligatoire au référentiel paramétrable, jamais un texte
     *  libre — c'est lui qui porte la durée par défaut, donc la capacité consommée. */
    motifId: uuid('motif_id').notNull(),
    /** Détail verbatim optionnel, EN PLUS du motif catalogué — jamais un substitut. */
    commentaire: text('commentaire'),

    type: typeOrdreReparationEnum('type').notNull(),

    date: date('date').notNull(),
    moment: momentRendezVousEnum('moment').notNull(),
    /** NULL = « moment respecté, heure non fixée » — jamais confondu avec `moment = 'toute_journee'`
     *  ni `statut = 'annule'` : trois représentations distinctes. */
    heureSouhaitee: time('heure_souhaitee'),
    /** Figée à la création depuis `motifRendezVous.dureeDefautMinutes` (applicatif), modifiable
     *  ensuite. NOT NULL : la capacité doit toujours être calculable. */
    dureeEstimeeMinutes: smallint('duree_estimee_minutes').notNull(),

    statut: statutPriseRendezVousEnum('statut').notNull().default('confirme'),
    /** Obligatoire seulement à l'annulation — voir rendez_vous_annulation_motif_chk. */
    motifAnnulation: text('motif_annulation'),
    origine: origineCreationRendezVousEnum('origine').notNull().default('reservation'),

    confirmeLe: timestamp('confirme_le', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    honoreLe: timestamp('honore_le', { withTimezone: true, mode: 'date' }),
    absentConstateLe: timestamp('absent_constate_le', { withTimezone: true, mode: 'date' }),
    annuleLe: timestamp('annule_le', { withTimezone: true, mode: 'date' }),

    /** Qui a pris l'appel. Nullable : une reprise de données historique n'a pas toujours cette
     *  info. */
    creeParId: uuid('cree_par_id'),

    ...colonnesHorodatage(),
  },
  (t) => [
    unique('rendez_vous_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'rendez_vous_fk_site',
      columns: [t.tenantId, t.siteId],
      foreignColumns: [site.tenantId, site.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'rendez_vous_fk_client',
      columns: [t.tenantId, t.clientId],
      foreignColumns: [client.tenantId, client.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'rendez_vous_fk_vehicule',
      columns: [t.tenantId, t.vehiculeId],
      foreignColumns: [vehicule.tenantId, vehicule.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'rendez_vous_fk_motif',
      columns: [t.tenantId, t.motifId],
      foreignColumns: [motifRendezVous.tenantId, motifRendezVous.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'rendez_vous_fk_cree_par',
      columns: [t.tenantId, t.creeParId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),
    check('rendez_vous_duree_positive_chk', sql`${t.dureeEstimeeMinutes} > 0`),
    check(
      'rendez_vous_annulation_motif_chk',
      sql`${t.statut} <> 'annule' or ${t.motifAnnulation} is not null`,
    ),
    check(
      'rendez_vous_terminal_le_coherent_chk',
      sql`(${t.statut} = 'honore')  = (${t.honoreLe} is not null) and
          (${t.statut} = 'absent')  = (${t.absentConstateLe} is not null) and
          (${t.statut} = 'annule')  = (${t.annuleLe} is not null)`,
    ),
    // Vue planning du jour par site — requête la plus fréquente de l'écran agenda.
    index('rendez_vous_agenda_idx').on(t.tenantId, t.siteId, t.date, t.moment),
    // Comptage de capacité (affiché, jamais bloquant — surbooking = avertir) et rappels J-1.
    index('rendez_vous_actifs_idx')
      .on(t.tenantId, t.siteId, t.date, t.moment)
      .where(sql`${t.statut} = 'confirme'`),
    // Historique de RDV d'un client (fiche client).
    index('rendez_vous_client_idx').on(t.tenantId, t.clientId, t.date.desc()),
    // Historique de RDV d'un véhicule ; partiel car souvent NULL.
    index('rendez_vous_vehicule_idx')
      .on(t.tenantId, t.vehiculeId, t.date.desc())
      .where(sql`${t.vehiculeId} is not null`),
    // Liste paginée par curseur (GET /rendez-vous). PIÈGE CONNU (CONTRIBUTING.md) : lire cree_le::text +
    // valeurCurseurTimestamptz() côté lecture, jamais comparer des Date JS — contrainte sur le code
    // de lecture (apps/api/src/rendezvous/), pas sur cet index.
    index('rendez_vous_pagination_idx').on(t.tenantId, t.creeLe.desc(), t.id.desc()),
  ],
);

export type LigneRendezVous = typeof rendezVous.$inferSelect;
export type NouveauRendezVous = typeof rendezVous.$inferInsert;
