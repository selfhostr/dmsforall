/**
 * Module ventes — `financement_vente`. RV-39→RV-45. Contrat gelé :
 * `packages/shared/src/contrats/ventes/financement.ts` (`ReponseFinancement`).
 * Détail des règles, triggers et machine à états : migrations/0032_ventes.sql.
 */

import { check, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { colonneId, colonnesHorodatage } from '../colonnes-communes';
import { client } from '../atelier/client';
import { statutConfirmationFinancementEnum, typeFinancementVenteEnum } from './enums';
import { dossierVente } from './dossier-vente';

/**
 * Sous-ressource COLLECTION d'un dossier de vente (contrat, littéral : « PAS singulière comme
 * reprise.ts »/`/dossiers-vente/{id}/financements`) — plusieurs lignes possibles par dossier,
 * APPEND, jamais réécrit : un financement refusé (CV-03, TERMINAL) n'est jamais rouvert, le
 * dossier bascule sur un NOUVEAU mode de financement, une nouvelle ligne. Le « financement
 * courant » (contrat, `FinancementResume`) est une notion PUREMENT DE LECTURE — le plus récent
 * dont `statut != 'refuse'`, ou le plus récent tout court si tous sont refusés — jamais un
 * drapeau `actif` stocké : le contrat n'en expose aucun, et en poser un ici ouvrirait exactement
 * la seconde source de vérité que ce dépôt évite ailleurs (une INSERT qui oublierait de désactiver
 * l'ancien laisserait deux lignes « actives » sans qu'aucune contrainte ne le remarque — la
 * dérivation par tri est increvable par construction).
 */
export const financementVente = pgTable(
  'financement_vente',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    dossierVenteId: uuid('dossier_vente_id').notNull(),
    /** RV-39/RV-44 : `comptant`/`credit`/`leasing`, extensible (voir `enums.ts`). */
    type: typeFinancementVenteEnum('type').notNull(),
    /** RV-40 : fiche client existante de l'organisme de financement. Contrat, littéral :
     *  « obligatoire côté serveur pour credit/leasing » — CHECK ci-dessous couvre les DEUX types,
     *  pas seulement `leasing` (correction par rapport à une première lecture de RV-44 seule, la
     *  spécification de contrat étant plus précise que la règle métier prise isolément).
     *  `null` UNIQUEMENT pour `comptant`. */
    organismeId: uuid('organisme_id'),
    /** RV-42 : traçabilité seule (numéro, pas le détail financier — mensualité, durée, km
     *  contractuel — qui reste dans le système de l'organisme). */
    referenceContrat: text('reference_contrat'),
    /** Colonne SQL nommée `statut` (dispositif générique `verifier_transition()`, voir le
     *  commentaire équivalent sur `vehicule_stock.statutCommercial` — type PG réellement posé :
     *  `statut_financement_vente`, voir `enums.ts` en-tête). CV-03 : `comptant` est créé
     *  directement `confirme` (aucune confirmation tierce n'a de sens), `credit`/`leasing`
     *  démarrent `en_attente` — logique du service à l'INSERT, pas un défaut de colonne unique
     *  puisque la valeur initiale dépend du `type`. */
    statut: statutConfirmationFinancementEnum('statut').notNull(),
    /** `true` dès la création pour `comptant` (contrat, littéral). */
    confirmeLe: timestamp('confirme_le', { withTimezone: true, mode: 'date' }),
    refuseLe: timestamp('refuse_le', { withTimezone: true, mode: 'date' }),
    /** Obligatoire et renseigné UNIQUEMENT si `statut = 'refuse'` (CV-03) — même doctrine que
     *  `reprise.motif_refus`. */
    motifRefus: text('motif_refus'),
    /** Concurrence optimiste (`If-Match`), même patron que `ordre_reparation.version`. */
    version: integer('version').notNull().default(1),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('financement_vente_tenant_id_uk').on(t.tenantId, t.id),
    foreignKey({
      name: 'financement_vente_fk_dossier_vente',
      columns: [t.tenantId, t.dossierVenteId],
      foreignColumns: [dossierVente.tenantId, dossierVente.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'financement_vente_fk_organisme',
      columns: [t.tenantId, t.organismeId],
      foreignColumns: [client.tenantId, client.id],
    }).onDelete('restrict'),
    check(
      'financement_vente_organisme_requis_chk',
      sql`${t.type} = 'comptant' or ${t.organismeId} is not null`,
    ),
    check('financement_vente_motif_refus_chk', sql`${t.statut} <> 'refuse' or ${t.motifRefus} is not null`),
    // Le tri par (tenant_id, dossier_vente_id, cree_le desc) sert directement la dérivation en
    // lecture du « financement courant » (voir le commentaire de tête).
    index('financement_vente_dossier_idx').on(t.tenantId, t.dossierVenteId, t.creeLe.desc()),
  ],
);

export type LigneFinancementVente = typeof financementVente.$inferSelect;
export type NouveauFinancementVente = typeof financementVente.$inferInsert;
