/**
 * `pointage_verrouillage_site` — RM-95 : verrouillage de période. Détail des triggers et de
 * l'audit : `migrations/0030_pointage.sql`.
 *
 * DÉCISION DE MODÈLE, remontée comme hypothèse par `contrats/pointage/periode.ts` (« à confirmer
 * avec expert-database ») et tranchée ici : UN SEUL SEUIL MUTABLE par site, PAS une collection de
 * ressources `periode_pointage` avec leur propre cycle de vie. Raisons :
 *
 *  - Le contrat n'expose que `jusquauLe` (borne haute, INCLUSE) sur `verrouiller-periode` et
 *    `deverrouiller-periode` — jamais de borne basse. Ce n'est PAS un intervalle fermé comme
 *    `periode_comptable` (`facturation/periode-comptable.ts` : `debut`/`fin`, EXCLUDE GiST de
 *    non-chevauchement) : c'est un curseur qui avance (verrouiller) ou recule (contre-passation,
 *    RM-95), une seule valeur scalaire par site — une table de périodes distinctes n'aurait rien à
 *    représenter que cette seule valeur ne représente déjà.
 *  - RM-95 ne précise AUCUNE granularité (mensuelle, hebdomadaire...) — en inventer une serait une
 *    décision de modèle non demandée. Si le terrain réclame un jour un découpage plus fin
 *    (verrouiller février sans pouvoir verrouiller janvier a posteriori), la migration est
 *    ADDITIVE depuis ce modèle (nouvelle table, `periodeId` sur `pointage`), pas une rupture.
 *
 * `statut_periode_pointage` (`ouverte`/`verrouillee`, pré-déclaré `atelier/enums.ts` au lot 1)
 * reste VOLONTAIREMENT NON UTILISÉ ici : l'état « verrouillé jusqu'à quand » est entièrement porté
 * par `verrouilleJusquauLe is not null`, un second champ de statut ne ferait que le dupliquer. Le
 * type reste réservé pour la migration additive ci-dessus, le jour où elle a lieu.
 *
 * ENTITÉ D'AUDIT DÉDIÉE (`periode_pointage`, `ENTITES_AUDITEES`, ajoutée par cette même migration)
 * : distincte de l'entité `pointage` — celle-ci trace CHAQUE pointage individuel, celle-là trace
 * le GESTE de verrouillage/déverrouillage lui-même (qui, quand, avec quel motif), y compris le
 * motif de contre-passation que RM-95 rend obligatoire et qu'aucune ligne de `pointage` ne porte
 * individuellement pour une action en lot.
 *
 * `jusquauLe` est une DATE calendaire (`schemaDateJour` côté contrat), pas un `timestamptz` : RM-95
 * raisonne en jours (« tout pointage dont `debutLe` précède cette date »), jamais à la seconde.
 */

import { sql } from 'drizzle-orm';
import { check, date, foreignKey, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { colonnesHorodatage } from '../colonnes-communes';
import { site } from '../site';
import { tenant } from '../tenant';
import { utilisateur } from '../utilisateur';

export const pointageVerrouillageSite = pgTable(
  'pointage_verrouillage_site',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'restrict' }),
    siteId: uuid('site_id').notNull(),

    /** `null` = aucun verrouillage n'a jamais eu lieu sur ce site. Borne INCLUSE (RM-95). */
    verrouilleJusquauLe: date('verrouille_jusquau_le'),

    /** Dernière action connue (lock OU unlock) — l'historique complet vit dans `audit_atelier`
     *  sous l'entité `periode_pointage`. Motif optionnel au verrouillage, obligatoire à la
     *  contre-passation (RM-95) — cette asymétrie est portée par le SERVICE, pas par une colonne
     *  NOT NULL ici : la même colonne sert les deux actions. */
    dernierMotif: text('dernier_motif'),
    derniereActionLe: timestamp('derniere_action_le', { withTimezone: true, mode: 'date' }),
    dernierUtilisateurId: uuid('dernier_utilisateur_id'),

    ...colonnesHorodatage(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.siteId] }),

    foreignKey({
      name: 'pointage_verrouillage_site_fk_site',
      columns: [t.tenantId, t.siteId],
      foreignColumns: [site.tenantId, site.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'pointage_verrouillage_site_fk_utilisateur',
      columns: [t.tenantId, t.dernierUtilisateurId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),

    check(
      'pointage_verrouillage_site_derniere_action_coherente_chk',
      sql`(${t.derniereActionLe} is null) = (${t.dernierUtilisateurId} is null)`,
    ),

    // La PK (tenant_id, site_id) EST l'index d'accès : une ligne par site, jamais de pagination.
  ],
);

export type LignePointageVerrouillageSite = typeof pointageVerrouillageSite.$inferSelect;
export type NouvellePointageVerrouillageSite = typeof pointageVerrouillageSite.$inferInsert;
