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
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { colonnesHorodatage, colonneId, colonneTenantId } from '../colonnes-communes';
import { client } from '../atelier/client';
// Import direct du fichier (pas du barrel '../facturation') : même précaution que
// atelier/client.ts (0066) — enums.ts n'importe rien de relances, ce chemin direct est sûr.
import { origineDocumentEnum } from '../facturation/enums';
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
    /**
     * Reprise (migrations/0070_ancrages_origine_reprise_pneus_ventes_relances.sql) : dfa (créé
     * par DFA) ou reprise (importé). Même enum/sémantique que client.origine (0066). D-45 :
     * AUCUNE relance active n'est reprise — colonne posée pour cohérence de patron, pas parce
     * qu'un import réel écrira origine=reprise dans ce lot.
     */
    origine: origineDocumentEnum('origine').notNull().default('dfa'),
    /** Reprise (0070) : identifiant de relance source verbatim, jamais retouché. NULL si
     *  origine=dfa. */
    numeroOrigine: text('numero_origine'),
    typeRelance: typeRelanceEnum('type_relance').notNull(),
    objetType: objetTypeRelanceEnum('objet_type').notNull(),
    objetId: uuid('objet_id').notNull(),
    /**
     * Palier 1, 2, 3… au sens de `regle_relance.delaisJours` pour une VRAIE ligne d'escalade
     * (RA-05) — jamais 0 (voir CHECK). `NULL` réservé au marqueur de reprise (0072, D-45) : porte
     * `noteReprise` sans jamais occuper de palier réel — une contrainte UNIQUE ne traite jamais
     * deux NULL comme égaux, donc un marqueur n'entre jamais en collision avec
     * `relance_planifiee_tenant_type_objet_palier_uk` ni avec la vraie relance palier 1 que le job
     * de planification créera plus tard pour le même objet. `palier is null` implique
     * `statut = 'annulee'` (`relance_planifiee_palier_requis_actif_chk`) : un marqueur est
     * TOUJOURS inerte.
     */
    palier: smallint('palier'),
    clientId: uuid('client_id').notNull(),
    echeancePrevue: timestamp('echeance_prevue', { withTimezone: true, mode: 'date' }).notNull(),
    statut: statutRelancePlanifieeEnum('statut').notNull().default('a_planifier'),
    annuleRaison: raisonAnnulationRelanceEnum('annule_raison'),
    /**
     * D-45 (`docs/reprise/decisions.md`) : signalement « déjà relancée N fois côté ancien
     * système » — texte libre, jamais peuplé par cette migration (aucun écrivain d'import pour le
     * domaine relances à ce stade). Depuis 0072, réservée EN BASE au marqueur de reprise :
     * renseignée seulement quand `palier is null`
     * (`relance_planifiee_note_reprise_marqueur_chk`) — jamais sur une vraie ligne d'escalade.
     */
    noteReprise: text('note_reprise'),
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
    // 0072 : palier is null réservé au marqueur de reprise (voir commentaire de la colonne) —
    // relâché par rapport à 0045, toujours > 0 pour toute VRAIE ligne d'escalade.
    check('relance_planifiee_palier_positif_chk', sql`${t.palier} is null or ${t.palier} > 0`),
    /** `annule_raison` obligatoire et UNIQUEMENT quand `statut = 'annulee'` — même patron que
     *  `depot_pneus_sorti_motif_chk` (migrations/0043). Depuis 0072, ne s'applique qu'aux VRAIES
     *  lignes (`palier is not null`) — un marqueur de reprise n'a pas de vraie raison
     *  d'annulation à produire. */
    check(
      'relance_planifiee_annulee_raison_chk',
      sql`${t.palier} is null or (${t.statut} = 'annulee') = (${t.annuleRaison} is not null)`,
    ),
    // 0072 : un marqueur de reprise (palier is null) est TOUJOURS inerte, jamais un statut actif
    // — verrouille en base ce que le commentaire de 0070 promettait sans l'imposer.
    check(
      'relance_planifiee_palier_requis_actif_chk',
      sql`${t.palier} is not null or ${t.statut} = 'annulee'`,
    ),
    // 0072 : noteReprise ne s'attache qu'à un marqueur (palier is null), jamais à une vraie ligne
    // d'escalade — même esprit que financement_vente_comptant_sans_detail_chk (0042).
    check(
      'relance_planifiee_note_reprise_marqueur_chk',
      sql`${t.noteReprise} is null or ${t.palier} is null`,
    ),
    // Reprise (0070) : même patron que ordre_reparation_origine_numero_origine_chk (0011).
    check(
      'relance_planifiee_origine_numero_origine_chk',
      sql`(${t.origine} = 'dfa') = (${t.numeroOrigine} is null)`,
    ),
    // relance_planifiee_numero_origine_uk (index unique PARTIEL, where numero_origine is not
    // null — 0070) n'est pas modélisable via `unique()` de pg-core (pas de clause WHERE) : posé
    // en SQL brut, même limite que ordre_reparation_numero_origine_uk (0011).
    check(
      'relance_planifiee_note_reprise_non_vide_chk',
      sql`${t.noteReprise} is null or length(btrim(${t.noteReprise})) > 0`,
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
