/**
 * Module ventes — `financement_vente`. RV-39→RV-45. Contrat gelé :
 * `packages/shared/src/contrats/ventes/financement.ts` (`ReponseFinancement`).
 * Détail des règles, triggers et machine à états : migrations/0032_ventes.sql.
 */

import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { colonneId, colonnesHorodatage } from '../colonnes-communes';
import { client } from '../atelier/client';
// Import direct du fichier (pas du barrel '../facturation') : même précaution que
// atelier/client.ts (0066) — enums.ts n'importe rien de ventes, ce chemin direct est sûr.
import { origineDocumentEnum } from '../facturation/enums';
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
    /**
     * Reprise (migrations/0070_ancrages_origine_reprise_pneus_ventes_relances.sql) : dfa (créé
     * par DFA) ou reprise (importé). Même enum/sémantique que client.origine (0066).
     */
    origine: origineDocumentEnum('origine').notNull().default('dfa'),
    /** Reprise (0070) : identifiant de financement/contrat source verbatim, jamais retouché. NULL
     *  si origine=dfa. */
    numeroOrigine: text('numero_origine'),
    dossierVenteId: uuid('dossier_vente_id').notNull(),
    /** RV-39/RV-44 : `comptant`/`credit`/`leasing`, extensible (voir `enums.ts`). */
    type: typeFinancementVenteEnum('type').notNull(),
    /** RV-40 : fiche client existante de l'organisme de financement. Contrat, littéral :
     *  « obligatoire côté serveur pour credit/leasing » — CHECK ci-dessous couvre les DEUX types,
     *  pas seulement `leasing` (correction par rapport à une première lecture de RV-44 seule, la
     *  spécification de contrat étant plus précise que la règle métier prise isolément).
     *  `null` UNIQUEMENT pour `comptant`, OU quand `organismeNom` (texte libre) le remplace —
     *  voir `financement_vente_organisme_requis_chk` (0071, D-42). */
    organismeId: uuid('organisme_id'),
    /** 0071 (D-42, docs/reprise/decisions.md) : texte libre si l'organisme de financement n'est
     *  pas (encore) une fiche client DFA — même doctrine que
     *  `reprise.detteFinancementOrganismeNom` (0032). Au moins l'un de `organismeId`/
     *  `organismeNom` est renseigné dès que `type <> 'comptant'`
     *  (`financement_vente_organisme_requis_chk`). AVERTISSEMENT : le contrat gelé
     *  (`packages/shared/src/contrats/ventes/financement.ts::ReponseFinancement`) n'expose pas
     *  encore ce champ — hors périmètre de cette colonne, à faire évoluer avant tout écrivain
     *  d'import D-42 pour `ventes_vn_vo` (qui n'existe pas encore, voir 0070). La résolution en
     *  fiche client se fait après coup, à la main : `organismeId` se renseigne alors EN PLUS,
     *  `organismeNom` reste tel quel (verbatim, jamais retouché, même doctrine que
     *  `numeroOrigine`). */
    organismeNom: text('organisme_nom'),
    /** RV-42 : traçabilité (numéro de contrat). RV-42 dit littéralement que le détail financier
     *  « reste dans le système de l'organisme » — TENSION SIGNALÉE (voir `montantFinanceCentimes`
     *  et le commentaire de tête de `contrats/ventes/financement.ts`, migration 0042) : un audit a
     *  constaté que ce module n'exposait nulle part combien le client paie, et les cinq colonnes
     *  ci-dessous comblent cette lacune en tant que SAISIE du vendeur, sans devenir la source de
     *  vérité du contrat (le kilométrage contractuel, par exemple, n'est délibérément pas repris). */
    referenceContrat: text('reference_contrat'),
    /** Montant financé (principal), en centimes. Ajouté par la migration 0042 — voir le
     *  commentaire ci-dessus sur `referenceContrat` et l'en-tête de `contrats/ventes/financement.ts`
     *  pour la tension avec `RV-42`. `null` pour `comptant` (CHECK ci-dessous) et tant que le
     *  vendeur ne l'a pas saisi pour `credit`/`leasing`. */
    montantFinanceCentimes: integer('montant_finance_centimes'),
    /** Acompte/apport versé à la signature, en centimes. Même doctrine que
     *  `montantFinanceCentimes` (0042). */
    acompteCentimes: integer('acompte_centimes'),
    /** Mensualité (crédit) ou loyer (leasing), en centimes. Même doctrine que
     *  `montantFinanceCentimes` (0042). */
    mensualiteCentimes: integer('mensualite_centimes'),
    /** Taux d'intérêt/leasing, en POUR MILLE (`81` = 8,1 %, même unité que
     *  `atelier/parametrage.ts::tauxTvaPourmille`). Même doctrine que `montantFinanceCentimes`
     *  (0042). */
    tauxInteretPourmille: smallint('taux_interet_pourmille'),
    /** Durée du contrat en mois. Même doctrine que `montantFinanceCentimes` (0042). */
    dureeMois: smallint('duree_mois'),
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
    // 0071 (D-42) : relâchée par rapport à 0032 — organismeId (fiche résolue) OU organismeNom
    // (texte libre) suffit, même disjonction que reprise_dette_organisme_coherent_chk.
    check(
      'financement_vente_organisme_requis_chk',
      sql`${t.type} = 'comptant' or ${t.organismeId} is not null or ${t.organismeNom} is not null`,
    ),
    // 0071 : même patron que reprise_dette_organisme_nom_non_vide_chk (0032).
    check(
      'financement_vente_organisme_nom_non_vide_chk',
      sql`${t.organismeNom} is null or length(btrim(${t.organismeNom})) > 0`,
    ),
    check(
      'financement_vente_motif_refus_chk',
      sql`${t.statut} <> 'refuse' or ${t.motifRefus} is not null`,
    ),
    // Colonnes monétaires (0042) — filet base, positif ou nul quand renseigné, même patron que
    // reprise.ts (`reprise_valeur_estimee_chk` etc.).
    check(
      'financement_vente_montant_finance_chk',
      sql`${t.montantFinanceCentimes} is null or ${t.montantFinanceCentimes} >= 0`,
    ),
    check(
      'financement_vente_acompte_chk',
      sql`${t.acompteCentimes} is null or ${t.acompteCentimes} >= 0`,
    ),
    check(
      'financement_vente_mensualite_chk',
      sql`${t.mensualiteCentimes} is null or ${t.mensualiteCentimes} >= 0`,
    ),
    check(
      'financement_vente_taux_interet_chk',
      sql`${t.tauxInteretPourmille} is null or ${t.tauxInteretPourmille} between 0 and 1000`,
    ),
    check(
      'financement_vente_duree_chk',
      sql`${t.dureeMois} is null or ${t.dureeMois} between 1 and 120`,
    ),
    // RV-44 : un `comptant` n'est PAS un financement — cohérence avec
    // `financement_vente_organisme_requis_chk` ci-dessus, même raisonnement appliqué aux cinq
    // colonnes monétaires plutôt qu'à `organisme_id` seul.
    check(
      'financement_vente_comptant_sans_detail_chk',
      sql`${t.type} <> 'comptant'
          or (${t.montantFinanceCentimes} is null
              and ${t.acompteCentimes} is null
              and ${t.mensualiteCentimes} is null
              and ${t.tauxInteretPourmille} is null
              and ${t.dureeMois} is null)`,
    ),
    // Reprise (0070) : même patron que ordre_reparation_origine_numero_origine_chk (0011).
    check(
      'financement_vente_origine_numero_origine_chk',
      sql`(${t.origine} = 'dfa') = (${t.numeroOrigine} is null)`,
    ),
    // financement_vente_numero_origine_uk (index unique PARTIEL, where numero_origine is not
    // null — 0070) n'est pas modélisable via `unique()` de pg-core (pas de clause WHERE) : posé
    // en SQL brut, même limite que ordre_reparation_numero_origine_uk (0011).
    // Le tri par (tenant_id, dossier_vente_id, cree_le desc) sert directement la dérivation en
    // lecture du « financement courant » (voir le commentaire de tête).
    index('financement_vente_dossier_idx').on(t.tenantId, t.dossierVenteId, t.creeLe.desc()),
  ],
);

export type LigneFinancementVente = typeof financementVente.$inferSelect;
export type NouveauFinancementVente = typeof financementVente.$inferInsert;
