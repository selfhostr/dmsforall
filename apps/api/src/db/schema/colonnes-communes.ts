/**
 * Briques de colonnes réutilisées par toutes les tables du socle.
 *
 * Ce sont des **fonctions** et non des objets constants : chaque table obtient ses propres
 * instances de constructeurs de colonnes. Partager un même objet entre plusieurs `pgTable`
 * fonctionne la plupart du temps mais crée un couplage subtil au moment où l'on veut dériver
 * une colonne (`.references()`, `.default()`) pour une seule table.
 */

import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Type `bytea` (Postgres) ↔ `Buffer` (Node).
 *
 * Défini en `customType` plutôt qu'avec un helper natif : le mapping Buffer ↔ bytea est ainsi
 * explicite et stable quelle que soit la version de Drizzle. Utilisé pour
 * `session.empreinte_token` — 32 octets bruts, jamais de texte hexadécimal (deux fois plus
 * gros, et une comparaison sensible à la casse de plus).
 */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/**
 * Clé primaire technique.
 *
 * UUID v4 généré par la base (`gen_random_uuid()`, intégré au cœur depuis PG 13) plutôt qu'un
 * entier séquentiel : en multi-tenant, un identifiant séquentiel divulgue le volume d'activité
 * et rend une énumération d'URL triviale. Contrepartie (index plus volumineux, insertions
 * moins localisées qu'avec un UUID v7) assumée aux volumétries visées.
 */
export const colonneId = () => uuid('id').primaryKey().defaultRandom();

/** Horodatage de création — `timestamptz`, jamais `timestamp` : une heure sans fuseau ment. */
export const colonneCreeLe = () =>
  timestamp('cree_le', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

/**
 * Horodatages standard. `modifie_le` est maintenu par le trigger `touche_modifie_le()`
 * (migration 0000) et non par l'applicatif : un UPDATE passé par un script de maintenance
 * ou une migration de données met la colonne à jour de la même façon.
 */
export const colonnesHorodatage = () => ({
  creeLe: colonneCreeLe(),
  modifieLe: timestamp('modifie_le', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

/**
 * Colonne de rattachement au tenant, sans la contrainte de clé étrangère (chaque table la
 * déclare elle-même pour rester maîtresse de son `ON DELETE`).
 *
 * Toujours `NOT NULL` sauf `journal_securite`, qui doit pouvoir tracer une tentative de
 * connexion sur un email inconnu — donc sans tenant identifiable.
 */
export const colonneTenantId = () => uuid('tenant_id').notNull();
