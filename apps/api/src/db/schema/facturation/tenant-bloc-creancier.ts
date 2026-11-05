/**
 * `tenant_bloc_creancier` — bloc créancier du QR-facture (RF-54/PF-03), porté par le tenant.
 * Détail des règles, du choix des deux colonnes IBAN/QR-IBAN et des CHECK associées :
 * migrations/0014_bloc_creancier_tenant.sql.
 *
 * Un tenant a au plus une ligne ici (`tenant_bloc_creancier_tenant_id_uk`, unique sur
 * `tenant_id` seul — pas de site, choix produit 30.07.2026). Toutes les colonnes sont
 * nullables : un créancier incomplet ne bloque jamais la création du tenant, seulement
 * l'émission d'une facture (contrôle applicatif, `facturation/qr/adresse.ts`,
 * `CHAMPS_REQUIS_BLOC_CREANCIER`).
 */

import { sql } from 'drizzle-orm';
import { char, check, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { colonneCreeLe, colonneId } from '../colonnes-communes';
import { tenant } from '../tenant';

export const tenantBlocCreancier = pgTable(
  'tenant_bloc_creancier',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id, { onDelete: 'restrict' }),

    /** Adresse structurée à 7 champs du QR (AdrTp + pays comptés côté encodeur, non stockés). */
    nom: text('nom'),
    rue: text('rue'),
    numero: text('numero'),
    npa: text('npa'),
    localite: text('localite'),
    pays: char('pays', { length: 2 }).notNull().default('CH'),

    /**
     * Deux comptes distincts et indépendants — jamais un seul champ qui jouerait les deux
     * rôles (choix produit). Forme COMPACTE exigée par le CHECK (majuscules, sans espace,
     * 21 caractères) : c'est celle que `validerIbanCreancier()` renvoie.
     */
    iban: text('iban'),
    qrIban: text('qr_iban'),

    creeLe: colonneCreeLe(),
    modifieLe: timestamp('modifie_le', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    unique('tenant_bloc_creancier_tenant_id_uk').on(t.tenantId),

    check('tenant_bloc_creancier_pays_chk', sql`${t.pays} ~ '^[A-Z]{2}$'`),

    // Forme + pays (CH/LI) + longueur (21, impliquée par le motif). Pas de clé modulo 97 en
    // base — voir la justification détaillée dans la migration.
    check(
      'tenant_bloc_creancier_iban_chk',
      sql`${t.iban} is null or ${t.iban} ~ '^(CH|LI)[0-9]{2}[0-9A-Z]{17}$'`,
    ),

    // Même forme, plus l'IID (position 5-9) dans la plage réservée aux QR-IBAN (30000-31999,
    // `IID_QR_IBAN_MIN`/`MAX` de `facturation/qr/iban.ts`).
    check(
      'tenant_bloc_creancier_qr_iban_chk',
      sql`${t.qrIban} is null or (
        ${t.qrIban} ~ '^(CH|LI)[0-9]{2}[0-9A-Z]{17}$'
        and substring(${t.qrIban} from 5 for 5) ~ '^[0-9]{5}$'
        and substring(${t.qrIban} from 5 for 5)::integer between 30000 and 31999
      )`,
    ),
  ],
);

export type LigneTenantBlocCreancier = typeof tenantBlocCreancier.$inferSelect;
export type NouveauTenantBlocCreancier = typeof tenantBlocCreancier.$inferInsert;
