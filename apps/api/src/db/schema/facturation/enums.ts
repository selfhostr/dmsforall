/**
 * Énumérations de l'étape 2 (facturation). Détail des règles : migrations/0010_facturation.sql §1.
 *
 * ÉCART ASSUMÉ à la doctrine « SOURCE UNIQUE `@dfa/shared` » suivie par `schema/atelier/enums.ts` :
 * `packages/shared/src/contrats/` n'a PAS ENCORE de contrat de facturation (aucun fichier
 * `contrats/facturation/*`) — le construire appartient à expert-api/expert-facturation, hors du
 * périmètre de cette migration (`apps/api/src/db/migrations` + `apps/api/src/db/schema`
 * exclusivement). Les valeurs sont donc dupliquées ICI, en dur, le temps que le contrat partagé
 * existe. Quand il existera, ces tableaux doivent être remplacés par des imports depuis
 * `@dfa/shared`, sur le modèle de `schema/atelier/enums.ts` — ne pas les laisser diverger.
 */

import { pgEnum } from 'drizzle-orm/pg-core';

// --- MD-01 : deux populations, une seule table.
export const origineDocumentEnum = pgEnum('origine_document', ['dfa', 'reprise']);

// --- MD-11 : quatre séries de numérotation indépendantes.
export const typeDocumentVenteEnum = pgEnum('type_document_vente', [
  'devis',
  'bon_commande',
  'facture',
  'avoir',
]);

// --- MD-12 : la facture d'acompte n'est pas un cinquième type.
export const natureFactureEnum = pgEnum('nature_facture', ['ordinaire', 'acompte']);

// --- MD-15 : union des états atteignables par les quatre types de document_vente — la légalité
// PAR TYPE vit dans `transition_document_autorisee` (0010 §6), pas dans ce type PG.
export const statutDocumentVenteEnum = pgEnum('statut_document_vente', [
  'brouillon',
  'emis',
  'accepte',
  'refuse',
  'expire',
  'remplace',
  'transforme',
  'annule',
  'annule_par_avoir',
  'abandonne',
]);

// --- MD-16 : dérivé, maintenu par trigger depuis imputation_paiement.
export const statutReglementDocumentEnum = pgEnum('statut_reglement_document', [
  'non_regle',
  'partiel',
  'regle',
  'trop_percu',
  'irrecouvrable',
]);

// --- MD-37 : le taux seul ne suffit pas (exonere/exclu valent tous deux 0 ‰).
export const regimeTvaEnum = pgEnum('regime_tva', [
  'normal',
  'reduit',
  'hebergement',
  'exonere',
  'exclu',
  'marge',
  'acquisition',
]);

/**
 * MD-43 / §0.2 de la migration : type PG complet (`ht`|`ttc`), restreint à `ttc` par CHECK pour
 * le lot pilote — décision de @laupernoe du 29.07.2026 (RF-40, montants toujours saisis/affichés TTC).
 * Voir `ligne_document_mode_ttc_lot_pilote_chk`.
 */
export const modeCalculTvaEnum = pgEnum('mode_calcul_tva', ['ht', 'ttc']);

/**
 * Type de ligne du DOCUMENT (distinct de `type_ligne_or` de l'étape 1, contrat gelé) : `remise`
 * n'existe jamais ici (RF-45, DFA ventile toujours la remise globale — MD-59), et quatre valeurs
 * n'ont pas d'équivalent atelier (acompte_deduit, repartition, consigne, ecart_reprise).
 */
export const typeLigneDocumentEnum = pgEnum('type_ligne_document', [
  'main_oeuvre_bareme',
  'main_oeuvre_temps_reel',
  'forfait',
  'piece',
  'fourniture',
  'sous_traitance',
  'produit_atelier',
  'taxe',
  'texte',
  'acompte_deduit',
  'repartition',
  'consigne',
  'ecart_reprise',
]);

// --- MD-50.
export const natureImputationEnum = pgEnum('nature_imputation', [
  'reglement',
  'escompte',
  'arrondi',
  'perte',
  'compensation',
]);
export const moyenPaiementEnum = pgEnum('moyen_paiement', [
  'especes',
  'carte',
  'virement',
  'qr',
  'twint',
  'compensation',
  'leasing',
]);
export const paiementSourceEnum = pgEnum('paiement_source', ['manuel', 'camt054', 'terminal']);

// --- RF-15.
export const motifAvoirEnum = pgEnum('motif_avoir', [
  'erreur_adresse',
  'erreur_montant',
  'erreur_destinataire',
  'erreur_taux',
  'prestation_annulee',
  'geste_commercial',
  'autre',
]);
export const porteeAvoirEnum = pgEnum('portee_avoir', ['total', 'partiel']);

// --- MD-74.
export const typeReferenceQrEnum = pgEnum('type_reference_qr', ['qrr', 'scor', 'non']);

// --- MD-82.
export const motifBulletinPaiementEnum = pgEnum('motif_bulletin_paiement', [
  'facture',
  'solde',
  'relance',
  'creance_reprise',
]);

// --- MD-84/88/91.
export const statutExportComptableEnum = pgEnum('statut_export_comptable', [
  'genere',
  'transmis',
  'accepte',
  'rejete',
]);
export const modeAgregationExportEnum = pgEnum('mode_agregation_export', ['detaille', 'agrege']);
/** ⚠️ RF (spec §0.3) : Abacus hors périmètre de l'étape 2, valeur posée quand même (coût nul). */
export const cibleExportEnum = pgEnum('cible_export', ['bexio', 'winbiz', 'abacus', 'banana', 'csv']);
export const usageMappingCompteEnum = pgEnum('usage_mapping_compte', [
  'creances_clients',
  'produit',
  'tva_due',
  'acomptes_recus',
  'financier',
  'arrondi',
  'escompte',
  'perte',
  'ecart_reprise',
]);
