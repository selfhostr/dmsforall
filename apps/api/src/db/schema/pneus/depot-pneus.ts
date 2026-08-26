/**
 * Module pneus — `depot_pneus` (hangar à pneus, Lot A). RPP-01→RPP-08.
 * Détail des règles, RLS, audit : migrations/0043_pneus_depot_pneus.sql.
 *
 * `vehicule` (`../atelier/vehicule`) et `ligne_or` (`../atelier/ordre-reparation`) sont importés
 * en LECTURE SEULE ici — propriété d'un autre périmètre, jamais modifiés depuis ce fichier.
 */

import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { colonneId, colonnesHorodatage } from '../colonnes-communes';
import { site } from '../site';
import { vehicule } from '../atelier/vehicule';
import { ligneOr } from '../atelier/ordre-reparation';
// Import direct du fichier (pas du barrel '../facturation') : même précaution que
// atelier/client.ts (0066) — enums.ts n'importe rien de pneus, ce chemin direct est sûr.
import { origineDocumentEnum } from '../facturation/enums';
import { motifSortieDepotPneusEnum, saisonPneuEnum, statutDepotPneusEnum } from './enums';

/**
 * Un jeu de pneus en dépôt, rattaché à un véhicule (RPP-01 : jamais de `client_id` direct, le
 * client se lit via `vehicule`). Pas de colonne `auteur_id` : l'audit générique
 * (`auditer_atelier`, trigger posé en migration) lit `utilisateur_courant()` depuis la session,
 * jamais une colonne de la table.
 */
export const depotPneus = pgTable(
  'depot_pneus',
  {
    id: colonneId(),
    // Pas de FK directe vers `tenant` ici (même patron que `stock_article`) : l'étanchéité
    // multi-tenant passe par les FK composites `(tenant_id, vehicule_id)` / `(tenant_id, site_id)`
    // ci-dessous, chacune scopée par tenant, plus la policy RLS.
    tenantId: uuid('tenant_id').notNull(),
    vehiculeId: uuid('vehicule_id').notNull(),
    siteId: uuid('site_id').notNull(),

    /**
     * Reprise (migrations/0070_ancrages_origine_reprise_pneus_ventes_relances.sql) : même enum et
     * même sémantique que client.origine (0066) — dfa (créé par DFA) ou reprise (importé).
     */
    origine: origineDocumentEnum('origine').notNull().default('dfa'),
    /** Reprise (0070) : identifiant du dépôt source verbatim, jamais retouché. NULL si
     *  origine=dfa. */
    numeroOrigine: text('numero_origine'),

    saison: saisonPneuEnum('saison').notNull(),
    // Un jeu entre en dépôt par défaut — `changer-saison`/`sortir` (API, hors périmètre schéma)
    // sont les seuls chemins vers les trois autres valeurs.
    statut: statutDepotPneusEnum('statut').notNull().default('en_depot'),

    /** Patron `stock_article.emplacement` (RPP-07) : texte libre, borne applicative uniquement. */
    codeCase: text('code_case'),
    /** Recopié de `vehicule.pneusEte`/`pneusHiver` au moment de l'entrée, ex. "205/55 R16". */
    dimension: text('dimension'),
    /** Observation libre ("usure 4mm"). */
    etat: text('etat'),

    entreLe: timestamp('entre_le', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    dernierMouvementLe: timestamp('dernier_mouvement_le', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),

    /** Requis quand `statut = 'sorti'` (RPP-05) — voir `depot_pneus_sorti_motif_chk`. */
    motifSortie: motifSortieDepotPneusEnum('motif_sortie'),

    /** Traçabilité RPP-03 : la ligne d'OR qui a réalisé le dernier changement de saison. */
    ligneOrDernierChangementId: uuid('ligne_or_dernier_changement_id'),

    ...colonnesHorodatage(),
  },
  (t) => [
    // Cible de FK composites futures (aucune table ne référence encore `depot_pneus`, posée par
    // cohérence avec le patron du dépôt — `vehicule_tenant_id_uk`, `site_tenant_id_uk`, etc. —
    // ex. une future ligne de facturation du forfait dépôt, RPP-08).
    unique('depot_pneus_tenant_id_uk').on(t.tenantId, t.id),

    foreignKey({
      name: 'depot_pneus_fk_vehicule',
      columns: [t.tenantId, t.vehiculeId],
      foreignColumns: [vehicule.tenantId, vehicule.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'depot_pneus_fk_site',
      columns: [t.tenantId, t.siteId],
      foreignColumns: [site.tenantId, site.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'depot_pneus_fk_ligne_or_dernier_changement',
      columns: [t.tenantId, t.ligneOrDernierChangementId],
      foreignColumns: [ligneOr.tenantId, ligneOr.id],
    }).onDelete('restrict'),

    check(
      'depot_pneus_sorti_motif_chk',
      sql`(${t.statut} = 'sorti') = (${t.motifSortie} is not null)`,
    ),

    // Reprise (0070) : même patron que ordre_reparation_origine_numero_origine_chk (0011).
    check(
      'depot_pneus_origine_numero_origine_chk',
      sql`(${t.origine} = 'dfa') = (${t.numeroOrigine} is null)`,
    ),
    // depot_pneus_numero_origine_uk (index unique PARTIEL, where numero_origine is not null —
    // 0070) n'est pas modélisable via `unique()` de pg-core (pas de clause WHERE) : posé en SQL
    // brut, même limite que ordre_reparation_numero_origine_uk (0011).

    // RPP-02 : à un instant T, au plus un jeu ACTIF (en_depot ou monté) par véhicule et par
    // saison. Ne peut pas être une contrainte UNIQUE de table (la clause WHERE n'existe que sur
    // un index) — même patron que `dossier_vente_vehicule_engage_uk`.
    uniqueIndex('depot_pneus_actif_uk')
      .on(t.tenantId, t.vehiculeId, t.saison)
      .where(sql`${t.statut} in ('en_depot', 'monte')`),

    // Vue hangar par site (GET /sites/{siteId}/hangar-pneus, §5 de la spec).
    index('depot_pneus_site_statut_idx').on(t.tenantId, t.siteId, t.statut),

    // Job de relance RPP-04 : jeux `en_depot` sans mouvement depuis le délai paramétrable.
    index('depot_pneus_relance_idx')
      .on(t.tenantId, t.dernierMouvementLe)
      .where(sql`${t.statut} = 'en_depot'`),
  ],
);

export type LigneDepotPneus = typeof depotPneus.$inferSelect;
export type NouveauDepotPneus = typeof depotPneus.$inferInsert;
