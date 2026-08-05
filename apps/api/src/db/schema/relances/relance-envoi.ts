/**
 * `relance_envoi` — APPEND-ONLY, une ligne par TENTATIVE d'envoi (§5, §6.2/§6.4). Même doctrine
 * que `client_consentement` (`schema/atelier/client.ts`) : pas de `modifie_le`, une ligne ne se
 * modifie jamais — c'est la preuve après coup (« qu'est-ce qu'on a envoyé, quand, et est-ce que
 * ça a marché ») que ce module doit pouvoir rendre sans reconstruction.
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

import { colonneCreeLe, colonneId, colonneTenantId } from '../colonnes-communes';
import { langueEnum } from '../enums';
import { canalRelanceEnum, statutEnvoiRelanceEnum } from './enums';
import { relancePlanifiee } from './relance-planifiee';

export const relanceEnvoi = pgTable(
  'relance_envoi',
  {
    id: colonneId(),
    tenantId: colonneTenantId(),
    relancePlanifieeId: uuid('relance_planifiee_id').notNull(),
    /** 1, 2, 3… — numéro de tentative pour CE `relancePlanifieeId` (jamais un identifiant de
     *  réessai côté connecteur, qui reste porté par `cleIdempotence` chez l'adaptateur). */
    tentative: smallint('tentative').notNull(),
    canal: canalRelanceEnum('canal').notNull(),
    /** DONNÉE PERSONNELLE figée (RA-12) — jamais recalculée depuis `client` après coup : un
     *  e-mail corrigé demain ne doit pas changer ce qu'on a réellement composé hier. */
    destinataireFige: text('destinataire_fige').notNull(),
    langueFigee: langueEnum('langue_figee').notNull(),
    /** DONNÉE PERSONNELLE figée (RA-12) — texte réellement envoyé, jamais recalculé depuis un
     *  gabarit modifié après coup. */
    contenuFige: text('contenu_fige').notNull(),
    statutEnvoi: statutEnvoiRelanceEnum('statut_envoi').notNull(),
    fournisseurMessageId: text('fournisseur_message_id'),
    erreur: text('erreur'),
    envoyeLe: timestamp('envoye_le', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    creeLe: colonneCreeLe(),
  },
  (t) => [
    unique('relance_envoi_tenant_id_uk').on(t.tenantId, t.id),
    unique('relance_envoi_tenant_planifiee_tentative_uk').on(
      t.tenantId,
      t.relancePlanifieeId,
      t.tentative,
    ),
    foreignKey({
      name: 'relance_envoi_fk_relance_planifiee',
      columns: [t.tenantId, t.relancePlanifieeId],
      foreignColumns: [relancePlanifiee.tenantId, relancePlanifiee.id],
    }).onDelete('restrict'),
    check('relance_envoi_tentative_positive_chk', sql`${t.tentative} > 0`),
    check(
      'relance_envoi_echoue_erreur_chk',
      sql`(${t.statutEnvoi} = 'echoue') = (${t.erreur} is not null)`,
    ),
    /** L'adaptateur ne rend JAMAIS un `identifiantMessagePrestataire` vide sur acceptation
     *  (`notification-sender.ts`, décision 1) — cette CHECK fait respecter côté base la même
     *  garantie que le contrat partagé décrit côté TypeScript. */
    check(
      'relance_envoi_envoye_fournisseur_id_chk',
      sql`(${t.statutEnvoi} = 'envoye') = (${t.fournisseurMessageId} is not null)`,
    ),
    /** Trace exploitable par tenant, triée dans le temps (§6.4 : « pour n'importe quel client, à
     *  n'importe quel moment, répondre… sans reconstruction »). */
    index('relance_envoi_envoye_le_idx').on(t.tenantId, t.envoyeLe),
  ],
);

export type LigneRelanceEnvoi = typeof relanceEnvoi.$inferSelect;
export type NouvelleRelanceEnvoi = typeof relanceEnvoi.$inferInsert;
