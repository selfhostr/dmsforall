/**
 * `parametre_envoi_courriel` — serveur d'envoi des e-mails d'un garage (migration 0098).
 * Une ligne par tenant ; `mot_de_passe_chiffre` est du texte chiffré applicatif (jamais le clair).
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { CAUSES_ECHEC_ENVOI_COURRIEL, SECURITES_SMTP } from '@dfa/shared';

import { colonnesHorodatage } from './colonnes-communes';
import { tenant } from './tenant';

/** Type PG : `securite_smtp`. */
export const securiteSmtpEnum = pgEnum('securite_smtp', SECURITES_SMTP);
/** Type PG : `cause_echec_envoi_courriel`. */
export const causeEchecEnvoiCourrielEnum = pgEnum(
  'cause_echec_envoi_courriel',
  CAUSES_ECHEC_ENVOI_COURRIEL,
);

export const parametreEnvoiCourriel = pgTable(
  'parametre_envoi_courriel',
  {
    tenantId: uuid('tenant_id')
      .primaryKey()
      .references(() => tenant.id, { onDelete: 'restrict' }),
    hote: text('hote').notNull(),
    port: integer('port').notNull(),
    securite: securiteSmtpEnum('securite').notNull(),
    utilisateur: text('utilisateur'),
    motDePasseChiffre: text('mot_de_passe_chiffre'),
    adresseExpediteur: text('adresse_expediteur').notNull(),
    nomAffiche: text('nom_affiche'),
    adresseReponse: text('adresse_reponse'),
    dernierTestLe: timestamp('dernier_test_le', { withTimezone: true, mode: 'date' }),
    dernierTestSucces: boolean('dernier_test_succes'),
    dernierTestCause: causeEchecEnvoiCourrielEnum('dernier_test_cause'),
    ...colonnesHorodatage(),
  },
  (t) => [
    check('parametre_envoi_courriel_port_chk', sql`${t.port} between 1 and 65535`),
    check('parametre_envoi_courriel_hote_chk', sql`length(${t.hote}) between 1 and 253`),
  ],
);

export type LigneParametreEnvoiCourriel = typeof parametreEnvoiCourriel.$inferSelect;
