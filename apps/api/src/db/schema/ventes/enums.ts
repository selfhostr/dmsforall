/**
 * Énumérations Postgres de l'étape 4 (Ventes VN/VO).
 *
 * Dérivées de `@dfa/shared` (`contrats/ventes/enums.ts`), SOURCE UNIQUE — même doctrine que
 * `schema/pieces/enums.ts`. Les types PG sont créés dans `migrations/0032_ventes.sql`.
 *
 * NOMMAGE DES TYPES PG — DIVERGE DE CE QUE `contrats/ventes/enums.ts` SUGGÈRE EN COMMENTAIRE,
 * SIGNALÉ AU MAINTENEUR (pas corrigé ici, `contrats/ventes/**` appartient à un autre lot) :
 * le dispositif générique de machine à états (`transition_autorisee` + `verifier_transition()`,
 * migrations/0003 §4.3, `transition_autorisee_valide_contenu()`) exige que le type Postgres
 * d'une entité `<entite>` s'appelle EXACTEMENT `statut_<entite>`
 * (`to_regtype('public.statut_' || entite)`), et la doctrine constatée sur
 * `ordre_reparation`/`ligne_or`/`commande_fournisseur` est que la valeur `entite_auditee`
 * correspond au nom de la TABLE. Conséquence, vérifiée en écrivant `migrations/0032_ventes.sql`
 * (une `insert into transition_autorisee` avec un type introuvable échoue immédiatement,
 * §4.3) :
 *   - entité `vehicule_stock` ⇒ type PG **`statut_vehicule_stock`**, PAS
 *     `statut_commercial_vehicule` comme l'annonce le commentaire de
 *     `STATUTS_COMMERCIAUX_VEHICULE` côté contrat ;
 *   - entité `financement_vente` ⇒ type PG **`statut_financement_vente`**, PAS
 *     `statut_confirmation_financement` comme l'annonce le commentaire de
 *     `STATUTS_CONFIRMATION_FINANCEMENT` côté contrat.
 * `statut_dossier_vente` et `statut_reprise` correspondent en revanche exactement à ce que leurs
 * commentaires respectifs annoncent déjà — aucune divergence sur ces deux-là. Dans tous les cas,
 * les VALEURS de chaque type Postgres restent identiques aux constantes partagées ci-dessous
 * (verrouillé par `schema.spec.ts`) : seul le NOM SQL du type diverge pour deux des quatre
 * machines, jamais son contenu.
 */

import { pgEnum } from 'drizzle-orm/pg-core';
import {
  STATUTS_COMMERCIAUX_VEHICULE,
  STATUTS_CONFIRMATION_FINANCEMENT,
  STATUTS_DOSSIER_VENTE,
  STATUTS_REPRISE,
  TYPES_FINANCEMENT_VENTE,
} from '@dfa/shared';

// --- 0032 (véhicule en stock, RV-01→RV-14, §6.1) ---------------------------------------------
/** Type PG `statut_vehicule_stock` (voir en-tête) — porte `StatutCommercialVehicule` (RV-09). */
export const statutCommercialVehiculeEnum = pgEnum(
  'statut_vehicule_stock',
  STATUTS_COMMERCIAUX_VEHICULE,
);

// --- 0032 (dossier de vente, RV-29→RV-38, §6.2) -----------------------------------------------
export const statutDossierVenteEnum = pgEnum('statut_dossier_vente', STATUTS_DOSSIER_VENTE);

// --- 0032 (reprise, RV-19→RV-28, §6.3) ---------------------------------------------------------
export const statutRepriseEnum = pgEnum('statut_reprise', STATUTS_REPRISE);

// --- 0032 (financement / leasing, RV-39→RV-45) -------------------------------------------------
/** Extensible (RV-39/44, comme `provenance_commande_fournisseur` ou `categorie_article`) — un
 *  nouveau canal de financement se pose par `ALTER TYPE ... ADD VALUE` dans une migration future,
 *  jamais par un `CHECK IN (...)` réécrit. */
export const typeFinancementVenteEnum = pgEnum('type_financement_vente', TYPES_FINANCEMENT_VENTE);
/** Type PG `statut_financement_vente` (voir en-tête) — porte `StatutConfirmationFinancement`
 *  (CV-03). */
export const statutConfirmationFinancementEnum = pgEnum(
  'statut_financement_vente',
  STATUTS_CONFIRMATION_FINANCEMENT,
);
