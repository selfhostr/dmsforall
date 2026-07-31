/**
 * Module ventes — `reprise`. RV-19→RV-28, §6.3, §8.3. Contrat gelé :
 * `packages/shared/src/contrats/ventes/reprise.ts`.
 * Détail des règles, triggers et machine à états : migrations/0032_ventes.sql.
 */

import { check, foreignKey, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { colonneId, colonnesHorodatage } from '../colonnes-communes';
import { client } from '../atelier/client';
import { vehicule } from '../atelier/vehicule';
import { statutRepriseEnum } from './enums';
import { dossierVente } from './dossier-vente';

/**
 * Sous-ressource SINGULIÈRE d'un dossier de vente : au plus UNE reprise par dossier
 * (`unique(tenant_id, dossier_vente_id)` ci-dessous — contrat : « pas de POST /reprises
 * autonome… au plus une par dossier, 409 sinon »). `vehiculeRepriseId` référence un `vehicule`
 * TOUJOURS déjà existant (contrat, littéral : « DOIT déjà exister… pas de second identifiant ») —
 * pas de FK vers `vehicule_stock` ici, le véhicule repris n'entre en stock qu'à la livraison
 * (RV-24, effet de bord porté par `dossier-vente.ts`, pas par cette table).
 *
 * `ecartRepriseVehiculeCentimes` (contrat, `valeurNegocieeCentimes - valeurEstimeeCentimes`)
 * n'est PAS une colonne : dérivé, calculé à la lecture — même doctrine que `joursStock` côté
 * `vehicule-stock.ts`, pour ne jamais ouvrir une seconde source de vérité sur une soustraction
 * triviale entre deux colonnes déjà présentes.
 */
export const reprise = pgTable(
  'reprise',
  {
    id: colonneId(),
    tenantId: uuid('tenant_id').notNull(),
    dossierVenteId: uuid('dossier_vente_id').notNull(),
    vehiculeRepriseId: uuid('vehicule_reprise_id').notNull(),
    /** Colonne SQL nommée `statut` (dispositif générique `verifier_transition()`, voir le
     *  commentaire équivalent sur `vehicule_stock.statutCommercial`) — ici sans divergence de nom
     *  de type PG, `statut_reprise` correspond exactement à l'entité `reprise`. */
    statut: statutRepriseEnum('statut').notNull().default('estimee'),
    /** RV-19 : évaluation technique/argus au moment de l'estimation. Sans valeur contractuelle
     *  tant que `statut = 'estimee'` (RV-27). */
    valeurEstimeeCentimes: integer('valeur_estimee_centimes').notNull(),
    /** RV-19 : `null` tant que `statut = 'estimee'` — c'est CETTE valeur, jamais l'estimée, qui
     *  figure en déduction sur le document de vente (RV-19) et devient le prix d'achat d'entrée en
     *  stock du véhicule repris à la livraison (RV-24). */
    valeurNegocieeCentimes: integer('valeur_negociee_centimes'),
    /** RV-26/CV-02 : solde de financement (leasing/crédit) encore dû par le client sur le véhicule
     *  repris — condition suspensive de la reprise. `null` = aucune dette connue. */
    detteFinancementResiduelleCentimes: integer('dette_financement_residuelle_centimes'),
    /** CV-02 : fiche client/tiers existante si elle l'est déjà dans DFA. */
    detteFinancementOrganismeId: uuid('dette_financement_organisme_id'),
    /** CV-02 : texte libre si l'organisme n'est pas (encore) une fiche DFA. Contrat : « au moins
     *  l'un des deux [organismeId, organismeNom] est renseigné quand la dette n'est pas null — non
     *  vérifié par le TYPE, vérifié serveur » — CHECK ci-dessous posé en base EN PLUS du contrôle
     *  serveur annoncé par le contrat (défense en profondeur, jamais l'inverse). */
    detteFinancementOrganismeNom: text('dette_financement_organisme_nom'),
    /** Obligatoire et renseigné UNIQUEMENT si `statut = 'refusee'` (RV-25). Valeur courante seule,
     *  même doctrine que `vehicule_stock.dernier_motif_transition`. */
    motifRefus: text('motif_refus'),
    estimeeLe: timestamp('estimee_le', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    negocieeLe: timestamp('negociee_le', { withTimezone: true, mode: 'date' }),
    confirmeeLe: timestamp('confirmee_le', { withTimezone: true, mode: 'date' }),
    refuseeLe: timestamp('refusee_le', { withTimezone: true, mode: 'date' }),
    /** Concurrence optimiste (`If-Match`), même patron que `ordre_reparation.version`. */
    version: integer('version').notNull().default(1),
    ...colonnesHorodatage(),
  },
  (t) => [
    unique('reprise_tenant_id_uk').on(t.tenantId, t.id),
    unique('reprise_tenant_dossier_uk').on(t.tenantId, t.dossierVenteId),
    foreignKey({
      name: 'reprise_fk_dossier_vente',
      columns: [t.tenantId, t.dossierVenteId],
      foreignColumns: [dossierVente.tenantId, dossierVente.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'reprise_fk_vehicule_reprise',
      columns: [t.tenantId, t.vehiculeRepriseId],
      foreignColumns: [vehicule.tenantId, vehicule.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'reprise_fk_dette_organisme',
      columns: [t.tenantId, t.detteFinancementOrganismeId],
      foreignColumns: [client.tenantId, client.id],
    }).onDelete('restrict'),
    check('reprise_valeur_estimee_chk', sql`${t.valeurEstimeeCentimes} >= 0`),
    check(
      'reprise_valeur_negociee_chk',
      sql`${t.valeurNegocieeCentimes} is null or ${t.valeurNegocieeCentimes} >= 0`,
    ),
    check(
      'reprise_dette_residuelle_chk',
      sql`${t.detteFinancementResiduelleCentimes} is null or ${t.detteFinancementResiduelleCentimes} >= 0`,
    ),
    // RV-27 : « une reprise confirmée est liée à un bon de commande déjà signé » — la valeur
    // négociée existe donc dès que l'estimation est dépassée.
    check(
      'reprise_valeur_negociee_requise_chk',
      sql`${t.statut} = 'estimee' or ${t.valeurNegocieeCentimes} is not null`,
    ),
    check('reprise_motif_refus_chk', sql`${t.statut} <> 'refusee' or ${t.motifRefus} is not null`),
    check(
      'reprise_dette_organisme_nom_non_vide_chk',
      sql`${t.detteFinancementOrganismeNom} is null or length(btrim(${t.detteFinancementOrganismeNom})) > 0`,
    ),
    check(
      'reprise_dette_organisme_coherent_chk',
      sql`${t.detteFinancementResiduelleCentimes} is null or ${t.detteFinancementOrganismeId} is not null or ${t.detteFinancementOrganismeNom} is not null`,
    ),
    index('reprise_vehicule_reprise_idx').on(t.tenantId, t.vehiculeRepriseId),
  ],
);

export type LigneReprise = typeof reprise.$inferSelect;
export type NouvelleReprise = typeof reprise.$inferInsert;
