/**
 * `journal_securite` — piste d'audit des événements d'authentification.
 *
 * Table **append-only** : `dfa_app` ne reçoit que `SELECT` et `INSERT` (migration 0001). Un
 * journal qu'on peut modifier ou effacer depuis l'application ne prouve rien le jour où il faut
 * expliquer à un client ce qui s'est passé sur son compte.
 *
 * `tenant_id` est **nullable** : une tentative de connexion sur un email inconnu doit être
 * tracée alors qu'aucun tenant n'est identifiable. Conséquence directe sur le RLS —
 * `tenant_id = tenant_courant()` vaut NULL pour ces lignes, donc faux : elles sont invisibles
 * depuis l'application. C'est voulu, elles n'appartiennent à personne et ne sont consultables
 * que par l'exploitant (rôle propriétaire).
 */

import { sql } from 'drizzle-orm';
import { check, index, inet, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { colonneCreeLe, colonneId } from './colonnes-communes';
import { typeEvenementSecuriteEnum } from './enums';
import { tenant } from './tenant';
import { utilisateur } from './utilisateur';

export const journalSecurite = pgTable(
  'journal_securite',
  {
    id: colonneId(),

    /** Nullable — voir en-tête. `restrict` : un tenant ne se supprime pas, son journal non plus. */
    tenantId: uuid('tenant_id').references(() => tenant.id, { onDelete: 'restrict' }),

    type: typeEvenementSecuriteEnum('type').notNull(),

    /**
     * `set null` et non `restrict` : le journal ne doit jamais bloquer une opération
     * d'exploitation légitime sur les comptes. L'identité humaine reste lisible via
     * `email_tente`, qui est une copie, pas une référence.
     */
    utilisateurId: uuid('utilisateur_id').references(() => utilisateur.id, {
      onDelete: 'set null',
    }),

    /** Email saisi lors de la tentative, y compris s'il ne correspond à aucun compte. */
    emailTente: text('email_tente'),

    ip: inet('ip'),
    userAgent: text('user_agent'),

    /**
     * Contexte variable selon le type d'événement (motif du refus, durée du verrouillage,
     * compteur d'échecs). Cas d'usage légitime de JSONB : la forme dépend réellement de
     * l'événement. Ne doit JAMAIS contenir de mot de passe, de jeton ni d'empreinte.
     */
    details: jsonb('details').$type<Record<string, unknown>>(),

    /** Pas de `modifie_le` : une ligne de journal ne se modifie pas. */
    creeLe: colonneCreeLe(),
  },
  (t) => [
    // Consultation paginée du journal d'un tenant (écran « sécurité » côté admin), même tri
    // stable que partout ailleurs.
    index('journal_securite_tenant_pagination_idx').on(t.tenantId, t.creeLe.desc(), t.id.desc()),

    // Purge par rétention (`delete ... where cree_le < now() - interval '12 months'`).
    // C'est la table la plus volumineuse du socle : 200 tenants × ~50 comptes × quelques
    // connexions par jour, on est dans l'ordre de la dizaine de millions de lignes par an.
    // L'index précédent ne sert pas la purge (il ne couvre pas les lignes à tenant_id NULL,
    // précisément celles que génèrent les attaques par force brute).
    index('journal_securite_cree_le_idx').on(t.creeLe),

    // Enquête : « pourquoi ce compte est-il verrouillé », « cet email est-il ciblé ».
    // Partiel, car seules les lignes portant un email tenté ont un intérêt ici — et ce sont
    // justement celles dont le tenant_id est souvent NULL.
    index('journal_securite_email_tente_idx')
      .on(t.emailTente, t.creeLe.desc())
      .where(sql`email_tente is not null`),

    check(
      'journal_securite_email_tente_format_chk',
      sql`${t.emailTente} is null or length(${t.emailTente}) between 1 and 320`,
    ),
  ],
);

export type LigneJournalSecurite = typeof journalSecurite.$inferSelect;
export type NouvelEvenementSecurite = typeof journalSecurite.$inferInsert;
