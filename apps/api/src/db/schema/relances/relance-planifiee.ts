/**
 * `relance_planifiee` — une ligne par OCCASION (type + objet + palier), source de vérité de
 * l'idempotence (§5, §6.1 de la spec). Détail : migrations/0045_relances_socle.sql §3.
 *
 * `objetId` est polymorphe (`objetType` dit dans quelle table chercher) : PAS de FK unique,
 * même patron que `audit_atelier.entite_id` — une FK composite par type d'objet romprait le
 * modèle générique pour un gain d'intégrité que la vérification applicative « à l'exécution »
 * (RA-08/RA-09, exigée par la spec de toute façon) couvre déjà.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { colonnesHorodatage, colonneId, colonneTenantId } from '../colonnes-communes';
import { client } from '../atelier/client';
import {
  objetTypeRelanceEnum,
  raisonAnnulationRelanceEnum,
  statutRelancePlanifieeEnum,
  typeRelanceEnum,
} from './enums';

export const relancePlanifiee = pgTable(
  'relance_planifiee',
  {
    id: colonneId(),
    tenantId: colonneTenantId(),
    typeRelance: typeRelanceEnum('type_relance').notNull(),
    objetType: objetTypeRelanceEnum('objet_type').notNull(),
    objetId: uuid('objet_id').notNull(),
    /** Palier 1, 2, 3… au sens de `regle_relance.delaisJours` — jamais 0 (voir CHECK). */
    palier: smallint('palier').notNull(),
    clientId: uuid('client_id').notNull(),
    echeancePrevue: timestamp('echeance_prevue', { withTimezone: true, mode: 'date' }).notNull(),
    statut: statutRelancePlanifieeEnum('statut').notNull().default('a_planifier'),
    annuleRaison: raisonAnnulationRelanceEnum('annule_raison'),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('relance_planifiee_tenant_id_uk').on(t.tenantId, t.id),
    /** RA-05, §6.1 : LA contrainte qui garantit qu'un palier ne se planifie jamais deux fois —
     *  pas la logique applicative. `ON CONFLICT (tenant_id, type_relance, objet_id, palier) DO
     *  NOTHING` (service de planification) s'appuie exclusivement sur elle. */
    unique('relance_planifiee_tenant_type_objet_palier_uk').on(
      t.tenantId,
      t.typeRelance,
      t.objetId,
      t.palier,
    ),
    foreignKey({
      name: 'relance_planifiee_fk_client',
      columns: [t.tenantId, t.clientId],
      foreignColumns: [client.tenantId, client.id],
    }).onDelete('restrict'),
    check('relance_planifiee_palier_positif_chk', sql`${t.palier} > 0`),
    /** `annule_raison` obligatoire et UNIQUEMENT quand `statut = 'annulee'` — même patron que
     *  `depot_pneus_sorti_motif_chk` (migrations/0043). */
    check(
      'relance_planifiee_annulee_raison_chk',
      sql`(${t.statut} = 'annulee') = (${t.annuleRaison} is not null)`,
    ),
    /** Requête du job de planification (`WHERE statut = 'a_planifier'`) et du job d'envoi
     *  (`WHERE statut = 'prete'`), toutes deux filtrées par échéance — §6.1. */
    index('relance_planifiee_statut_echeance_idx').on(t.tenantId, t.statut, t.echeancePrevue),
    /** RA-07/08/09/14 : retrouver TOUTES les relances actives d'un objet donné pour les annuler
     *  quand il change d'état (facture réglée, devis accepté, véhicule cédé…) — sans ceci,
     *  chaque mécanisme d'arrêt automatique devrait scanner la table entière. */
    index('relance_planifiee_objet_idx').on(t.tenantId, t.objetType, t.objetId),
    /** RA-04/RA-10 : regroupement par CLIENT (pas par véhicule) des rappels dus le même jour —
     *  construire le digest Famille B exige de lister, pour un client donné, tout ce qui est
     *  `prete` autour d'une échéance proche. */
    index('relance_planifiee_client_echeance_idx').on(t.tenantId, t.clientId, t.echeancePrevue),
  ],
);

export type LigneRelancePlanifiee = typeof relancePlanifiee.$inferSelect;
export type NouvelleRelancePlanifiee = typeof relancePlanifiee.$inferInsert;
