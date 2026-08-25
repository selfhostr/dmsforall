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
 */

import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import type { TransactionDfa } from '../../../db';

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
