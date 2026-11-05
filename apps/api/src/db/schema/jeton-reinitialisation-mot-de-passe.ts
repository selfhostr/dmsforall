/**
 * `jeton_reinitialisation_mot_de_passe` — réinitialisation de mot de passe en libre-service
 * (« oubli de mot de passe »), distincte de la réinitialisation d'accès par un admin/direction
 * (`socle/service-utilisateur.ts::reinitialiserAcces`, qui ne passe PAS par cette table : un
 * admin génère et transmet lui-même un mot de passe temporaire).
 *
 * Même doctrine que `session` (voir son en-tête) : le jeton en clair (haute entropie, CSPRNG)
 * n'existe QUE dans le lien envoyé par courriel — la base ne stocke que son empreinte SHA-256.
 * Table TENANT-SCOPÉE malgré tout : contrairement à la session (résolue hors-tenant, par
 * `amorcage.session_par_empreinte`), le flux de réinitialisation résout d'abord le tenant via
 * `amorcage.utilisateur_par_email` (déjà une des 6 opérations d'amorçage — voir `db/db.types.ts`),
 * PUIS vérifie le jeton DANS ce tenant (`AccesBase.enTenant`, écriture normale). Aucune 7e
 * opération d'amorçage n'est donc nécessaire — voir le commentaire de `schemaConfirmationReinitialisationMotDePasse`
 * (`@dfa/shared`, `contrats/auth.ts`) pour le raisonnement complet.
 *
 * Deux marqueurs de fin de vie, DISTINCTS et non substituables l'un à l'autre :
 *  - `utilise_le` : le jeton a effectivement servi à changer le mot de passe (succès).
 *  - `revoque_le` : le jeton a été invalidé SANS avoir servi — soit parce qu'une demande plus
 *    récente l'a remplacé (`ServiceReinitialisationMotDePasseImpl.demander`, un seul jeton valide
 *    à la fois par compte), soit parce qu'un admin/direction a réinitialisé l'accès entre-temps
 *    (`ServiceUtilisateur.reinitialiserAcces`, DANS la même transaction — voir son commentaire :
 *    sans cette révocation, un jeton en libre-service émis avant l'incident resterait utilisable
 *    APRÈS que l'admin a repris la main sur le compte).
 * Un jeton valide au sens de la vérification est donc : `utilise_le IS NULL AND revoque_le IS
 * NULL AND expire_le > now()`.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  inet,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { bytea, colonneCreeLe, colonneId } from './colonnes-communes';
import { tenant } from './tenant';
import { utilisateur } from './utilisateur';

export const jetonReinitialisationMotDePasse = pgTable(
  'jeton_reinitialisation_mot_de_passe',
  {
    id: colonneId(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'restrict' }),

    utilisateurId: uuid('utilisateur_id').notNull(),

    /** SHA-256 du jeton en clair (32 octets) — même patron que `session.empreinte_token`. */
    empreinteJeton: bytea('empreinte_jeton').notNull(),

    /** Courte à dessein (voir `DUREE_JETON_REINITIALISATION_MINUTES`,
     *  `services/reinitialisation-mot-de-passe.service.ts`) : un lien de réinitialisation qui
     *  reste valide des heures est une fenêtre d'attaque sur une boîte courriel compromise. */
    expireLe: timestamp('expire_le', { withTimezone: true, mode: 'date' }).notNull(),

    /** Non nul = jeton effectivement consommé (mot de passe changé). Usage unique : un jeton
     *  `utilise_le` ne peut plus jamais servir, même s'il n'est pas encore expiré. */
    utiliseLe: timestamp('utilise_le', { withTimezone: true, mode: 'date' }),

    /** Non nul = invalidé sans avoir servi (demande plus récente, ou reprise de main par un
     *  admin/direction) — voir l'en-tête de ce fichier. */
    revoqueLe: timestamp('revoque_le', { withTimezone: true, mode: 'date' }),

    ip: inet('ip'),
    userAgent: text('user_agent'),

    creeLe: colonneCreeLe(),
  },
  (t) => [
    // FK composite : impose que le tenant du jeton soit celui de son utilisateur, même garde-fou
    // que `session_utilisateur_fk`.
    foreignKey({
      name: 'jeton_reinitialisation_mot_de_passe_utilisateur_fk',
      columns: [t.tenantId, t.utilisateurId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('cascade'),

    unique('jeton_reinitialisation_mot_de_passe_empreinte_uk').on(t.tenantId, t.empreinteJeton),

    // Sert `revoquerJetonsActifsDansTransaction` (invalider tout jeton en cours d'un utilisateur)
    // et la purge future des lignes expirées.
    index('jeton_reinitialisation_mot_de_passe_tenant_utilisateur_idx').on(
      t.tenantId,
      t.utilisateurId,
    ),
    index('jeton_reinitialisation_mot_de_passe_expire_le_idx').on(t.expireLe),

    check(
      'jeton_reinitialisation_mot_de_passe_empreinte_taille_chk',
      sql`octet_length(${t.empreinteJeton}) = 32`,
    ),
    check(
      'jeton_reinitialisation_mot_de_passe_expire_le_coherent_chk',
      sql`${t.expireLe} > ${t.creeLe}`,
    ),
  ],
);

export type LigneJetonReinitialisationMotDePasse =
  typeof jetonReinitialisationMotDePasse.$inferSelect;
export type NouveauJetonReinitialisationMotDePasse =
  typeof jetonReinitialisationMotDePasse.$inferInsert;
