/**
 * `tenant` — l'entreprise cliente. Racine de toute l'isolation multi-tenant.
 *
 * C'est la seule table dont la politique RLS porte sur `id` et non sur `tenant_id` : le tenant
 * est son propre tenant.
 */

import { sql } from 'drizzle-orm';
import { char, check, integer, pgTable, text, unique } from 'drizzle-orm/pg-core';

import { colonneId, colonnesHorodatage } from './colonnes-communes';
import { langueEnum, statutTenantEnum } from './enums';

export const tenant = pgTable(
  'tenant',
  {
    id: colonneId(),

    /**
     * Identifiant lisible et stable, utilisé en support et dans les URL d'administration.
     * Jamais transmis par un client pour choisir un tenant (§4 : aucun endpoint n'accepte de
     * tenantId) — c'est un confort d'exploitation, pas un mécanisme d'accès.
     */
    slug: text('slug').notNull(),

    /** Raison sociale telle qu'elle apparaît au registre du commerce et sur les factures. */
    raisonSociale: text('raison_sociale').notNull(),

    /**
     * N° TVA suisse (format CHE-123.456.789 TVA). Nullable : un garage sous le seuil
     * d'assujettissement (CHF 100'000 de chiffre d'affaires) n'en a pas. La validation fine du
     * format arrive avec la facturation (étape 2), là où elle a une conséquence réelle.
     */
    numeroTva: text('numero_tva'),

    /** Code pays ISO 3166-1 alpha-2. `CH` par défaut : le marché initial. */
    pays: char('pays', { length: 2 }).notNull().default('CH'),

    /** Langue par défaut de l'interface et des documents, surchargeable par utilisateur. */
    langueDefaut: langueEnum('langue_defaut').notNull().default('fr'),

    /**
     * `suspendu` = accès bloqué par l'exploitant mais données intactes ; `resilie` = sortie du garage,
     * conservation le temps de la rétention légale. Aucun de ces états n'efface de données :
     * la suppression est une opération d'exploitation explicite, jamais un effet de bord.
     */
    statut: statutTenantEnum('statut').notNull().default('actif'),

    /**
     * Délai de paiement PAR DÉFAUT (jours calendaires), migration 0046 (issue #17 du dépôt,
     * arbitré sans @laupernoe — voir l'en-tête de la migration pour la justification complète et le
     * chemin de retour arrière). Utilisé à l'émission d'une facture UNIQUEMENT quand le client
     * n'a AUCUNE condition commerciale en vigueur portant `delaiPaiementJours` — le délai du
     * client, quand il existe, l'emporte toujours (`facturation/documents/echeance.ts`). 30 =
     * usage suisse courant (« net 30 »).
     */
    delaiPaiementJoursDefaut: integer('delai_paiement_jours_defaut').notNull().default(30),

    ...colonnesHorodatage(),
  },
  (t) => [
    // Unicité globale du slug : il sert d'identifiant humain, une collision serait une source
    // d'erreur permanente au support.
    unique('tenant_slug_uk').on(t.slug),

    // Le slug entre dans des URL et des noms de fichiers d'export : on le contraint en base
    // plutôt que d'espérer que chaque chemin d'écriture pense à le normaliser.
    check(
      'tenant_slug_format_chk',
      sql`${t.slug} = lower(${t.slug}) and ${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,62}$'`,
    ),

    check('tenant_raison_sociale_non_vide_chk', sql`length(btrim(${t.raisonSociale})) > 0`),

    check('tenant_pays_format_chk', sql`${t.pays} ~ '^[A-Z]{2}$'`),
  ],
);

export type LigneTenant = typeof tenant.$inferSelect;
export type NouveauTenant = typeof tenant.$inferInsert;
