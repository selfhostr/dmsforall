/**
 * Écrivain de domaine `documents_vente` — PROTOCOLE EN DEUX TEMPS obligatoire (brief, point dur
 * mesuré) : `document_vente` naît TOUJOURS en `brouillon` (trigger `document_vente_creation_brouillon`,
 * migration 0010, SQLSTATE ZDFA1 sinon) et se VERROUILLE dès `statut <> 'brouillon'`
 * (`document_vente_verrouiller_apres_emission`) — un `INSERT` direct au statut `emis` est
 * MÉCANIQUEMENT rejeté par la base, ce n'est pas une option de conception.
 *
 * PÉRIMÈTRE (D-30, `entetes_totaux_tva_10_ans`) : EN-TÊTE + TOTAUX + TVA NON VENTILÉE SEULEMENT
 * (`tva_non_ventilee = true`, `taux_tva_pourmille` unique par document) — AUCUNE ligne
 * (`ligne_document`) écrite ici. C'est très exactement le régime que 0010 anticipe déjà pour la
 * reprise : `document_vente_taux_tva_doc_reprise_chk` n'autorise `taux_tva_pourmille` renseigné
 * QUE si `tva_non_ventilee` est vrai ET `origine = 'reprise'` — aucune migration n'a dû être
 * ajaptée pour ce writer.
 *
 * AMBIGUÏTÉ SIGNALÉE, PAS TRANCHÉE : `site_id` est NOT NULL sur `document_vente`, mais aucune
 * archive source ne porte de notion de site DFA — l'appelant (orchestrateur) doit fournir un
 * `siteIdDefaut` (aujourd'hui : le premier site du tenant). Correct pour un garage mono-site,
 * FAUX pour un groupe multi-sites qui reprend un historique déjà réparti — à confirmer avec
 * `expert-metier` avant un import réel.
 *
 * NON VÉRIFIÉ EN BASE RÉELLE (signalé, pas caché) : ce writer n'a pas tourné contre une vraie
 * transaction Postgres (`pnpm test:integration` non lancé pour ce chantier, voir rapport de
 * livraison) — les tests de ce module mockent `tx.execute`, qui prouve la SÉQUENCE d'appels
 * (brouillon -> émission) mais rien sur les contraintes réelles (CHECK, trigger) de 0010.
 *
 * DEUX PHASES SÉPARÉES, DÉLIBÉRÉMENT (même doctrine que `ecrivain-client-reprise.ts`, § tête de
 * `service-import-reprise.ts::executer`) : `preparerCandidatsDocumentsVenteReprise` (CPU pur —
 * extraction/validation des champs source, cessions d'event loop comprises) tourne HORS de toute
 * transaction ; `ecrireDocumentsVenteRepriseParLot` (I/O socket réelle, protocole brouillon ->
 * émission par candidat via `ecrireDocumentVenteReprise` ci-dessous) tourne DANS la transaction
 * COURTE ouverte par l'appelant pour cette écriture — AUCUNE cession d'event loop là-dedans, voir
 * la doctrine complète côté orchestrateur (`service-import-reprise.ts`). Avant ce découpage, les
 * DEUX étaient mêlées dans UNE SEULE boucle (`service-import-reprise.ts::ecrireDomaine`) qui cédait
 * la main À CHAQUE itération TOUT EN restant dans la transaction ouverte pour tout `executer()` —
 * exactement le défaut structurel que ce chantier élimine.
 */

import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import type { TransactionDfa } from '../../../db';
import type { AnomalieImportReprise } from '@dfa/shared';

import type { CedeurEventLoop } from '../../../common/concurrence';
import type { LigneTable } from '../../lecteurs/types';
import {
  accumulerDocumentReconciliation,
  type AccumulateurAnneeReprise,
} from '../reconciliation-annee-reprise';
import {
  indexerColonnesLigne,
  texteParAlias,
  valeurParAlias,
} from '../resolution-alias-colonne-reprise';
import {
  creerCompteurProgresEcriture,
  type CallbackProgresEcritureReprise,
} from '../progression-ecriture-reprise';

export interface EntreeDocumentVenteReprise {
  readonly tenantId: string;
  readonly siteId: string;
  readonly clientId: string;
  readonly clientDesignationFigee: string;
  readonly langueFigee: 'fr' | 'de' | 'it';
  readonly numeroOrigine: string;
  readonly dateDocument: string | null;
  readonly totalTtcCentimes: number;
  readonly totalTvaCentimes: number;
  readonly tauxTvaPourmille: number | null;
}

/** Étape 1 — création en brouillon. Rend l'id créé (ou de la ligne existante en cas de rejeu). */
async function creerBrouillon(
  tx: TransactionDfa,
  entree: EntreeDocumentVenteReprise,
): Promise<string | null> {
  const resultat = await tx.execute<{ readonly id: string }>(sql`
    insert into public.document_vente
      (id, tenant_id, site_id, type_document, origine, statut, client_id,
       client_designation_figee, langue_figee, adresse_facturation_figee,
       numero_origine, tva_non_ventilee, taux_tva_pourmille,
       total_ht_centimes, total_tva_centimes, total_ttc_centimes)
    values
      (${randomUUID()}, ${entree.tenantId}, ${entree.siteId}, 'facture', 'reprise', 'brouillon',
       ${entree.clientId}, ${entree.clientDesignationFigee}, ${entree.langueFigee}, '{}'::jsonb,
       ${entree.numeroOrigine}, true, ${entree.tauxTvaPourmille},
       ${entree.totalTtcCentimes - entree.totalTvaCentimes}, ${entree.totalTvaCentimes}, ${entree.totalTtcCentimes})
    on conflict (tenant_id, type_document, numero_origine) where numero_origine is not null
    do nothing
    returning id
  `);
  return resultat.rows[0]?.id ?? null;
}

/** Étape 2 — émission : SEULE transition qui peut fixer `numero`/`exercice`/`emis_le` (verrouillés
 *  ensuite par `document_vente_verrouiller_apres_emission`, 0010). */
async function emettre(
  tx: TransactionDfa,
  id: string,
  entree: EntreeDocumentVenteReprise,
): Promise<void> {
  const annee = entree.dateDocument
    ? Number(entree.dateDocument.slice(0, 4))
    : new Date().getUTCFullYear();
  await tx.execute(sql`
    update public.document_vente
       set statut = 'emis', numero = ${`REPR-${entree.numeroOrigine}`}, exercice = ${annee},
           date_document = ${entree.dateDocument}, emis_le = now()
     where tenant_id = ${entree.tenantId} and id = ${id} and statut = 'brouillon'
  `);
}

/**
 * Exécute le protocole en deux temps. Rend `{cree: false}` si `numeroOrigine` était déjà importé
 * (rejeu idempotent, `on conflict do nothing` — aucune deuxième émission tentée : l'étape 2 n'a de
 * sens que juste après l'étape 1 du MÊME appel).
 */
export async function ecrireDocumentVenteReprise(
  tx: TransactionDfa,
  entree: EntreeDocumentVenteReprise,
): Promise<{ readonly cree: boolean; readonly id: string | null }> {
  const id = await creerBrouillon(tx, entree);
  if (id === null) return { cree: false, id: null };
  await emettre(tx, id, entree);
  return { cree: true, id };
}

// -------------------------------------------------------------------------------------------
// Préparation (CPU pur, hors transaction) + écriture par lot (I/O réelle, transaction courte) —
// voir « DEUX PHASES SÉPARÉES » en tête de fichier.
// -------------------------------------------------------------------------------------------

export interface CandidatDocumentVenteRepriseRetenu {
  readonly numeroOrigine: string;
  readonly clientId: string;
  /** Désignation du client TELLE QUE VUE dans la source (`client_id`/référence brute) — figée sur
   *  le document, comme son nom l'indique (`clientDesignationFigee`, EntreeDocumentVenteReprise). */
  readonly clientDesignationFigee: string;
  readonly totalTtcCentimes: number;
  readonly dateDocument: string | null;
}

export interface ResultatPreparationDocumentsVenteReprise {
  readonly candidatsRetenus: readonly CandidatDocumentVenteRepriseRetenu[];
  readonly anomalies: readonly AnomalieImportReprise[];
}

/**
 * Phase 1 — CPU pur, AUCUN accès base : extraction/validation par ligne (référence, client déjà
 * résolu via `clientIdParNumeroOrigine`, montant). À appeler HORS de toute transaction.
 */
export async function preparerCandidatsDocumentsVenteReprise(
  lignes: readonly LigneTable[],
  clientIdParNumeroOrigine: ReadonlyMap<string, string>,
  cedeurEventLoop: CedeurEventLoop,
): Promise<ResultatPreparationDocumentsVenteReprise> {
  const anomalies: AnomalieImportReprise[] = [];
  const candidatsRetenus: CandidatDocumentVenteRepriseRetenu[] = [];

  // Rejets précoces (référence/montant manquants, `continue` ci-dessous) n'exécutent AUCUNE
  // requête — pur CPU sur une archive de mauvaise qualité — d'où la cession explicite à CHAQUE
  // itération, exactement comme les autres écrivains de domaine.
  for (const ligne of lignes) {
    await cedeurEventLoop.cederSiNecessaire();
    // Index insensible à la casse — voir `resolution-alias-colonne-reprise.ts` (même défaut réel
    // du 26.08.2026 que `ecrivain-client-reprise.ts`/`ecrivain-vehicule-reprise.ts` : casse
    // d'origine Access sur les colonnes source).
    const index = indexerColonnesLigne(ligne);
    const numeroOrigine = texteParAlias(index, 'id', 'numero') ?? '';
    const clientRef = texteParAlias(index, 'client_id') ?? '';
    const clientId = clientIdParNumeroOrigine.get(clientRef);
    const totalTtc = Number(valeurParAlias(index, 'total_ttc', 'montant') ?? 0);
    if (!numeroOrigine || !clientId || !Number.isFinite(totalTtc)) {
      anomalies.push({
        type: 'reference_manquante',
        domaine: 'documents_vente',
        ligneSource: ligne.index,
        donnees: { raison: 'client ou identifiant/montant source manquant' },
      });
      continue;
    }
    const dateBrute = valeurParAlias(index, 'date');
    const dateDocument =
      dateBrute instanceof Date
        ? dateBrute.toISOString().slice(0, 10)
        : typeof dateBrute === 'string'
          ? dateBrute
          : null;

    candidatsRetenus.push({
      numeroOrigine,
      clientId,
      clientDesignationFigee: clientRef,
      totalTtcCentimes: Math.round(totalTtc),
      dateDocument,
    });
  }

  return { candidatsRetenus, anomalies };
}

export interface ParametresEcritureDocumentsVenteReprise {
  readonly tenantId: string;
  readonly siteId: string;
  readonly langueFigee: 'fr' | 'de' | 'it';
}

export interface ResultatEcritureDocumentsVenteRepriseParLot {
  readonly insere: number;
}

/**
 * Phase 2 — écriture réelle (protocole brouillon -> émission par candidat retenu), dans la
 * transaction COURTE fournie par l'appelant. AUCUNE cession d'event loop ici : `ecrireDocument
 * VenteReprise` fait déjà plusieurs `tx.execute` réels par candidat, un aller-retour socket qui
 * cède naturellement la boucle d'événements. Mute `reconciliationParAnnee` EN PLACE (même patron
 * que l'appelant historique, `service-import-reprise.ts` avant ce découpage) plutôt que de
 * réassigner — `accumulerDocumentReconciliation` reste pure, seul CE point applique son résultat à
 * l'accumulateur mutable partagé par tout `executer()`.
 */
export async function ecrireDocumentsVenteRepriseParLot(
  tx: TransactionDfa,
  params: ParametresEcritureDocumentsVenteReprise,
  candidatsRetenus: readonly CandidatDocumentVenteRepriseRetenu[],
  reconciliationParAnnee: Map<number, AccumulateurAnneeReprise>,
  onProgres?: CallbackProgresEcritureReprise,
): Promise<ResultatEcritureDocumentsVenteRepriseParLot> {
  let insere = 0;
  // Progression VISIBLE en cours d'écriture — voir l'en-tête de `progression-ecriture-reprise.ts`
  // (défaut réel du 26.08.2026).
  const compteurProgres = creerCompteurProgresEcriture(onProgres);
  for (const candidat of candidatsRetenus) {
    const resultat = await ecrireDocumentVenteReprise(tx, {
      tenantId: params.tenantId,
      siteId: params.siteId,
      clientId: candidat.clientId,
      clientDesignationFigee: candidat.clientDesignationFigee,
      langueFigee: params.langueFigee,
      numeroOrigine: candidat.numeroOrigine,
      dateDocument: candidat.dateDocument,
      totalTtcCentimes: candidat.totalTtcCentimes,
      totalTvaCentimes: 0,
      tauxTvaPourmille: null,
    });
    if (resultat.cree) {
      insere += 1;
      const annee = candidat.dateDocument
        ? Number(candidat.dateDocument.slice(0, 4))
        : new Date().getUTCFullYear();
      const suivant = accumulerDocumentReconciliation(
        reconciliationParAnnee,
        annee,
        candidat.totalTtcCentimes,
      );
      reconciliationParAnnee.set(annee, suivant.get(annee)!);
    }
    await compteurProgres.incrementer();
  }
  return { insere };
}
