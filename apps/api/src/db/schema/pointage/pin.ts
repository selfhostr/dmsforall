/**
 * `pin_pointage` — RM-125 → RM-127 (`docs/specification-pointage-borne.md`). Détail des
 * triggers, contraintes et RLS : `migrations/0036_pointage_borne_pin.sql`.
 *
 * ENTITÉ PORTÉE : une ligne par (site, technicien), PAS par technicien seul — l'existence de la
 * ligne EST l'affectation « ce technicien peut pointer sur ce site en mode borne » (§0.1 de la
 * spec, trou comblé sans construire une table d'affectation générale utilisateur↔site). `actif`
 * en bascule l'éligibilité sans jamais supprimer la ligne (aucun DELETE accordé à `dfa_app`,
 * posture par défaut — voir la migration).
 *
 * `pinHash` : Argon2id encodé PHC, même primitif et mêmes paramètres que
 * `utilisateur.motDePasseHash` (RM-126). PAS de contrainte UNIQUE sur cette colonne : l'unicité
 * du PIN par site (RM-127) ne peut pas être une contrainte DB avec un hachage salé (deux
 * hachages du même PIN ne sont jamais égaux) — elle est vérifiée par le SERVICE à l'écriture
 * (itération des lignes actives du site cible + `argon2.verify()`), jamais ici.
 *
 * `id` : colonne technique posée SANS être consommée par un trigger d'audit dans ce socle (voir
 * décision (B), en-tête de la migration 0036) — `pin_pointage` n'est PAS branché sur
 * `auditer_atelier()`/`entite_auditee` à ce stade : RM-128 (qui/quand) est déjà satisfait par
 * `creeLe`/`creeParUtilisateurId`/`modifieLe`/`modifieParUtilisateurId` (dernier état connu,
 * même doctrine que `pointage.derniereCorrection*`). `id` existe malgré tout dès maintenant pour
 * qu'un futur branchement d'audit détaillé (extension additive) n'ait pas à reproduire la
 * correction de `migrations/0035_pointage_verrouillage_site_id_et_grant_sequence_article.sql`
 * (`auditer_atelier()` exige `NEW.id`/`OLD.id`).
 */

import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { colonneId, colonnesHorodatage } from '../colonnes-communes';
import { site } from '../site';
import { tenant } from '../tenant';
import { utilisateur } from '../utilisateur';

export const pinPointage = pgTable(
  'pin_pointage',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'restrict' }),
    siteId: uuid('site_id').notNull(),
    /** Le technicien rattaché à ce site en mode borne (§0.1 : l'existence de la ligne EST
     *  l'affectation). */
    utilisateurId: uuid('utilisateur_id').notNull(),

    /** Argon2id encodé PHC (`$argon2id$v=19$m=19456,t=2,p=1$...`). Jamais exposé par l'API,
     *  jamais en clair. */
    pinHash: text('pin_hash').notNull(),

    /** `false` = technicien plus éligible à la borne de ce site — jamais supprimé, voir l'en-tête
     *  du fichier. Filtré par le service à l'identification et à la vérification d'unicité. */
    actif: boolean('actif').notNull().default(true),

    ...colonnesHorodatage(),

    /** RM-128 : dernier état connu de « qui a attribué/réinitialisé, quand » — jamais NULL,
     *  aucun auto-service au lot 1. Historique complet des resets successifs volontairement HORS
     *  de ce modèle (voir en-tête) : extension additive future si le besoin devient réel. */
    creeParUtilisateurId: uuid('cree_par_utilisateur_id').notNull(),
    modifieParUtilisateurId: uuid('modifie_par_utilisateur_id').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'pin_pointage_fk_site',
      columns: [t.tenantId, t.siteId],
      foreignColumns: [site.tenantId, site.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'pin_pointage_fk_utilisateur',
      columns: [t.tenantId, t.utilisateurId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'pin_pointage_fk_cree_par',
      columns: [t.tenantId, t.creeParUtilisateurId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'pin_pointage_fk_modifie_par',
      columns: [t.tenantId, t.modifieParUtilisateurId],
      foreignColumns: [utilisateur.tenantId, utilisateur.id],
    }).onDelete('restrict'),

    // RM-125 : une ligne par (site, technicien) — pas par technicien seul. Sert aussi de chemin
    // d'accès « techniciens éligibles à cette borne » (préfixe tenant_id, site_id) : aucun index
    // supplémentaire posé, voir la migration §2.1.
    unique('pin_pointage_tenant_site_utilisateur_uk').on(t.tenantId, t.siteId, t.utilisateurId),

    check('pin_pointage_pin_hash_non_vide_chk', sql`length(${t.pinHash}) > 0`),
  ],
);

export type LignePinPointage = typeof pinPointage.$inferSelect;
export type NouveauPinPointage = typeof pinPointage.$inferInsert;
