/**
 * `session` — sessions authentifiées, adossées à un cookie opaque.
 *
 * Le jeton en clair (32 octets CSPRNG, base64url) n'existe QUE dans la réponse de connexion et
 * dans le cookie du navigateur. La base ne stocke que son empreinte **SHA-256**.
 *
 * Pourquoi SHA-256 et non Argon2 ici — alors qu'Argon2 est obligatoire pour les mots de passe :
 * un mot de passe est court, choisi par un humain, donc devinable ; un jeton de session porte
 * 256 bits d'entropie tirés du CSPRNG, il n'y a rien à deviner. Et cette empreinte est vérifiée
 * à CHAQUE requête authentifiée : y mettre Argon2 (19 MiB, 2 passes) reviendrait à s'infliger
 * un déni de service à chaque clic dans l'application.
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

export const session = pgTable(
  'session',
  {
    id: colonneId(),

    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'restrict' }),

    utilisateurId: uuid('utilisateur_id').notNull(),

    /** SHA-256 du jeton en clair — exactement 32 octets, contraint en base. */
    empreinteToken: bytea('empreinte_token').notNull(),

    /** Expiration absolue : `cree_le + SESSION_DUREE_MINUTES`. Ré-authentification obligatoire. */
    expireLe: timestamp('expire_le', { withTimezone: true, mode: 'date' }).notNull(),

    /**
     * Dernière activité observée. Sert l'expiration glissante
     * (`now() <= vu_le + SESSION_INACTIVITE_MINUTES`), qui protège les tablettes d'atelier
     * partagées laissées ouvertes.
     */
    vuLe: timestamp('vu_le', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),

    /** Non nul = session fermée (déconnexion, révocation par un admin, changement de mot de passe). */
    revoqueeLe: timestamp('revoquee_le', { withTimezone: true, mode: 'date' }),

    /** `inet` et non `text` : le type natif valide la valeur et gère IPv4 comme IPv6. */
    ip: inet('ip'),
    userAgent: text('user_agent'),

    /**
     * Pas de `modifie_le` ni de trigger sur cette table, contrairement au reste du socle :
     * `vu_le` est déjà l'horodatage de dernière modification, et c'est la ligne la plus
     * fréquemment mise à jour de toute l'application (une fois par requête authentifiée, soit
     * l'écrasante majorité du trafic). Un trigger PL/pgSQL sur ce chemin serait le seul coût
     * mesurable du socle.
     */
    creeLe: colonneCreeLe(),
  },
  (t) => [
    // Clé étrangère COMPOSITE, et non `utilisateur_id → utilisateur(id)`.
    // Elle impose que le tenant_id de la session soit celui de son utilisateur : la base refuse
    // physiquement une session « recollée » au mauvais tenant. C'est le garde-fou d'intégrité le
    // plus important de cette table.
    foreignKey({
      name: 'session_utilisateur_fk',
      columns: [t.tenantId, t.utilisateurId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('cascade'),

    // LE chemin d'accès de chaque requête authentifiée (`amorcage.session_par_empreinte`).
    // Unique : deux sessions ne peuvent pas partager une empreinte, et la recherche est un accès
    // index direct quel que soit le nombre de sessions vivantes de l'ensemble des tenants.
    unique('session_empreinte_token_uk').on(t.empreinteToken),

    // Révocation en masse : « déconnecter toutes les sessions de cet utilisateur » (changement
    // de mot de passe, suspension de compte) et écran « mes sessions actives ».
    index('session_tenant_utilisateur_idx').on(t.tenantId, t.utilisateurId),

    // Purge périodique des sessions expirées (`delete ... where expire_le < now()`). Sans lui,
    // le job de purge scanne toute la table ; avec 200 tenants × 50 utilisateurs × plusieurs
    // sessions par jour, elle grossit vite et c'est la seule table qu'on nettoie vraiment.
    index('session_expire_le_idx').on(t.expireLe),

    // 32 octets exactement : une empreinte tronquée ou un jeton stocké en clair par erreur ne
    // passe pas l'insertion.
    check('session_empreinte_token_taille_chk', sql`octet_length(${t.empreinteToken}) = 32`),

    // Une session ne peut pas expirer avant d'avoir été créée.
    check('session_expire_le_coherent_chk', sql`${t.expireLe} > ${t.creeLe}`),
  ],
);

export type LigneSession = typeof session.$inferSelect;
export type NouvelleSession = typeof session.$inferInsert;
