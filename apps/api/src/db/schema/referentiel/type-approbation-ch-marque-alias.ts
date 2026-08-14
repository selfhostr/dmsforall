/**
 * Alias de marques du référentiel véhicules suisse — `type_approbation_ch_marque_alias`
 * (migration 0051).
 *
 * Miroir Drizzle de `migrations/0051_referentiel_vehicules_ch_marque_alias.sql` : voir l'en-tête
 * de cette migration pour l'arbitrage complet (pourquoi une table plutôt qu'une constante
 * applicative, pourquoi pas de FK vers `type_approbation_ch`, la curation initiale et sa source).
 * Ce fichier ne fait que TYPER ce que la migration a créé.
 *
 * SANS `tenant_id` NI RLS, ET C'EST VOULU — même doctrine que `type-approbation-ch.ts` : donnée
 * éditoriale mais identique pour tous les tenants, déclarée `[dfa:referentiel-partage]` en base,
 * `dfa_app` n'y a que SELECT.
 *
 * L'index unique d'expression (`type_approbation_ch_marque_alias_recherche_uk`,
 * `normaliser_recherche(alias)` en `text_pattern_ops`) N'EST PAS mirroré ici — même doctrine que
 * `type_approbation_ch_marque_modele_recherche_idx` (0050) : les index sur expression restent
 * décrits uniquement dans la migration SQL, qui fait foi.
 *
 * La lecture applicative (`service-referentiel-vehicules-ch.ts`) reste en SQL brut via
 * `tx.execute`, comme pour `type_approbation_ch` — ce miroir sert le typage et le contrôle de
 * dérive `drizzle-kit generate`, pas un accès Drizzle direct (les 4 lignes de curation initiale
 * sont posées par la migration elle-même, aucun script applicatif n'écrit dans cette table).
 */

import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const typeApprobationChMarqueAlias = pgTable(
  'type_approbation_ch_marque_alias',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Forme d'affichage telle qu'un humain la tape (ex. « Volkswagen ») — rendue au client via
     *  `aliasTrouve` quand une recherche est résolue par cet alias. */
    alias: text('alias').notNull(),
    /** Doit correspondre à une valeur réelle de `type_approbation_ch.marque` — vérifié
     *  manuellement à la curation, pas par FK (voir en-tête de la migration 0051). */
    marqueCanonique: text('marque_canonique').notNull(),
    /** Traçabilité éditoriale : d'où vient l'alias. */
    source: text('source').notNull(),
    creeLe: timestamp('cree_le', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    modifieLe: timestamp('modifie_le', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'type_approbation_ch_marque_alias_alias_non_vide_chk',
      sql`length(btrim(${t.alias})) > 0`,
    ),
    check(
      'type_approbation_ch_marque_alias_marque_canonique_non_vide_chk',
      sql`length(btrim(${t.marqueCanonique})) > 0`,
    ),
    check(
      'type_approbation_ch_marque_alias_source_non_vide_chk',
      sql`length(btrim(${t.source})) > 0`,
    ),
    check(
      'type_approbation_ch_marque_alias_distinct_de_la_cible_chk',
      sql`public.normaliser_recherche(${t.alias}) <> public.normaliser_recherche(${t.marqueCanonique})`,
    ),
  ],
);

export type LigneTypeApprobationChMarqueAlias = typeof typeApprobationChMarqueAlias.$inferSelect;
export type NouveauTypeApprobationChMarqueAlias = typeof typeApprobationChMarqueAlias.$inferInsert;
