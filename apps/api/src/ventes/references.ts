import { and, desc, eq, inArray } from 'drizzle-orm';

import type { ContexteTenant, TransactionDfa } from '../db';
import {
  documentVente,
  dossierVente,
  dossierVenteDocumentRequis,
  financementVente,
  ligneDocument,
  reprise,
  vehiculeStock,
  type LigneDocumentVente,
  type LigneDossierVente,
  type LigneDossierVenteDocumentRequis,
  type LigneFinancementVente,
  type LigneReprise,
  type LigneVehiculeStock,
} from '../db/schema';
import { ErreurMetier } from '../common/erreurs/erreur-metier';
// Import direct du fichier (jamais un barrel `facturation/`) : fonction PURE, sans accès base ni
// dépendance NestJS — même patron déjà en place pour `roleVoitLesMontants`, réutilisée en LECTURE
// par `ventes/mappers.ts` depuis `facturation/documents/mappeurs.ts` (RF-116). Ce module ne modifie
// jamais `document_vente`/`ligne_document` (propriété de `facturation/`, voir plus bas).
import { calculerTotauxDocument } from '../facturation/documents/calcul-document';

/**
 * Lectures PARTAGÉES entre les services de ce module (`vehicule_stock`, `dossier_vente`,
 * `reprise`, `financement_vente`) — même doctrine que `atelier/references.ts` : rescoping explicite
 * sur `tenant_id` en plus du RLS (le RLS est le filet, jamais le mécanisme).
 *
 * Chaque `chargerXOuNull(tx, ctx, id, pourEcriture)` prend `select … for update` quand
 * `pourEcriture = true` — verrouille la ligne pour toute la durée de la transaction, empêchant deux
 * transitions concurrentes sur la même entité d'évaluer leurs gardes contre le même état de départ
 * (même patron que `atelier/or-requetes.ts::chargerOrOuNull`).
 */

/* ------------------------------------------------------------------ */
/* vehicule_stock                                                      */
/* ------------------------------------------------------------------ */

export async function chargerVehiculeStockOuNull(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
  pourEcriture = false,
): Promise<LigneVehiculeStock | null> {
  const condition = and(eq(vehiculeStock.tenantId, ctx.tenantId), eq(vehiculeStock.id, vehiculeId));
  const [ligne] = pourEcriture
    ? await tx.select().from(vehiculeStock).where(condition).limit(1).for('update')
    : await tx.select().from(vehiculeStock).where(condition).limit(1);
  return ligne ?? null;
}

export async function chargerVehiculeStock(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
): Promise<LigneVehiculeStock> {
  const ligne = await chargerVehiculeStockOuNull(tx, ctx, vehiculeId, false);
  if (!ligne) {
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Ce véhicule n'a jamais été mis en stock.`);
  }
  return ligne;
}

export async function chargerVehiculeStockPourEcriture(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  vehiculeId: string,
): Promise<LigneVehiculeStock> {
  const ligne = await chargerVehiculeStockOuNull(tx, ctx, vehiculeId, true);
  if (!ligne) {
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Ce véhicule n'a jamais été mis en stock.`);
  }
  return ligne;
}

/* ------------------------------------------------------------------ */
/* dossier_vente                                                       */
/* ------------------------------------------------------------------ */

export async function chargerDossierVenteOuNull(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  dossierVenteId: string,
  pourEcriture = false,
): Promise<LigneDossierVente | null> {
  const condition = and(
    eq(dossierVente.tenantId, ctx.tenantId),
    eq(dossierVente.id, dossierVenteId),
  );
  const [ligne] = pourEcriture
    ? await tx.select().from(dossierVente).where(condition).limit(1).for('update')
    : await tx.select().from(dossierVente).where(condition).limit(1);
  return ligne ?? null;
}

export async function chargerDossierVente(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  dossierVenteId: string,
): Promise<LigneDossierVente> {
  const ligne = await chargerDossierVenteOuNull(tx, ctx, dossierVenteId, false);
  if (!ligne) {
    throw new ErreurMetier(
      'RESSOURCE_INTROUVABLE',
      `Dossier de vente ${dossierVenteId} introuvable.`,
    );
  }
  return ligne;
}

export async function chargerDossierVentePourEcriture(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  dossierVenteId: string,
): Promise<LigneDossierVente> {
  const ligne = await chargerDossierVenteOuNull(tx, ctx, dossierVenteId, true);
  if (!ligne) {
    throw new ErreurMetier(
      'RESSOURCE_INTROUVABLE',
      `Dossier de vente ${dossierVenteId} introuvable.`,
    );
  }
  return ligne;
}

/* ------------------------------------------------------------------ */
/* reprise — sous-ressource SINGULIÈRE d'un dossier (0 ou 1)           */
/* ------------------------------------------------------------------ */

export async function chargerRepriseParDossierOuNull(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  dossierVenteId: string,
  pourEcriture = false,
): Promise<LigneReprise | null> {
  const condition = and(
    eq(reprise.tenantId, ctx.tenantId),
    eq(reprise.dossierVenteId, dossierVenteId),
  );
  const [ligne] = pourEcriture
    ? await tx.select().from(reprise).where(condition).limit(1).for('update')
    : await tx.select().from(reprise).where(condition).limit(1);
  return ligne ?? null;
}

export async function chargerRepriseParDossier(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  dossierVenteId: string,
): Promise<LigneReprise> {
  const ligne = await chargerRepriseParDossierOuNull(tx, ctx, dossierVenteId, false);
  if (!ligne) {
    throw new ErreurMetier(
      'RESSOURCE_INTROUVABLE',
      `Aucune reprise pour le dossier de vente ${dossierVenteId}.`,
    );
  }
  return ligne;
}

export async function chargerRepriseParDossierPourEcriture(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  dossierVenteId: string,
): Promise<LigneReprise> {
  const ligne = await chargerRepriseParDossierOuNull(tx, ctx, dossierVenteId, true);
  if (!ligne) {
    throw new ErreurMetier(
      'RESSOURCE_INTROUVABLE',
      `Aucune reprise pour le dossier de vente ${dossierVenteId}.`,
    );
  }
  return ligne;
}

/* ------------------------------------------------------------------ */
/* financement_vente — sous-ressource COLLECTION d'un dossier          */
/* ------------------------------------------------------------------ */

/** Toutes les tentatives de financement d'un dossier, `creeLe desc` — sert à la fois la liste
 *  embarquée (`ReponseDossierVente.financements`) et la dérivation du « financement courant »
 *  (`FinancementResume` : le plus récent dont `statut != 'refuse'`, ou le plus récent tout court). */
export async function listerFinancementsDossier(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  dossierVenteId: string,
): Promise<readonly LigneFinancementVente[]> {
  return tx
    .select()
    .from(financementVente)
    .where(
      and(
        eq(financementVente.tenantId, ctx.tenantId),
        eq(financementVente.dossierVenteId, dossierVenteId),
      ),
    )
    .orderBy(desc(financementVente.creeLe));
}

export async function chargerFinancementOuNull(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  dossierVenteId: string,
  financementId: string,
  pourEcriture = false,
): Promise<LigneFinancementVente | null> {
  const condition = and(
    eq(financementVente.tenantId, ctx.tenantId),
    eq(financementVente.dossierVenteId, dossierVenteId),
    eq(financementVente.id, financementId),
  );
  const [ligne] = pourEcriture
    ? await tx.select().from(financementVente).where(condition).limit(1).for('update')
    : await tx.select().from(financementVente).where(condition).limit(1);
  return ligne ?? null;
}

export async function chargerFinancementPourEcriture(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  dossierVenteId: string,
  financementId: string,
): Promise<LigneFinancementVente> {
  const ligne = await chargerFinancementOuNull(tx, ctx, dossierVenteId, financementId, true);
  if (!ligne) {
    throw new ErreurMetier(
      'RESSOURCE_INTROUVABLE',
      `Financement ${financementId} introuvable pour ce dossier de vente.`,
    );
  }
  return ligne;
}

/* ------------------------------------------------------------------ */
/* documents requis (check-list de livraison, RV-35)                   */
/* ------------------------------------------------------------------ */

export async function listerDocumentsRequis(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  dossierVenteId: string,
): Promise<readonly LigneDossierVenteDocumentRequis[]> {
  return tx
    .select()
    .from(dossierVenteDocumentRequis)
    .where(
      and(
        eq(dossierVenteDocumentRequis.tenantId, ctx.tenantId),
        eq(dossierVenteDocumentRequis.dossierVenteId, dossierVenteId),
      ),
    )
    .orderBy(dossierVenteDocumentRequis.creeLe);
}

/* ------------------------------------------------------------------ */
/* documents de la chaîne facturation liés au dossier (document_vente. */
/* dossier_vente_id, MD-70) — lecture SEULE, ce module ne les modifie  */
/* jamais (propriété de `facturation/`).                               */
/* ------------------------------------------------------------------ */

export const SEUIL_DOCUMENTS_DOSSIER = 50;

/** Rend au plus `SEUIL_DOCUMENTS_DOSSIER + 1` lignes — au service d'appeler `.slice()` et de
 *  poser `documentsTronques`, même patron que `atelier/service-or.ts::assemblerDocument`. */
export async function listerDocumentsDossierBrut(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  dossierVenteId: string,
): Promise<readonly LigneDocumentVente[]> {
  return tx
    .select()
    .from(documentVente)
    .where(
      and(
        eq(documentVente.tenantId, ctx.tenantId),
        eq(documentVente.dossierVenteId, dossierVenteId),
      ),
    )
    .orderBy(desc(documentVente.dateDocument))
    .limit(SEUIL_DOCUMENTS_DOSSIER + 1);
}

/**
 * Total TTC à AFFICHER pour chaque document, un par `document.id` (#127, bug prouvé : la carte
 * « Documents » d'un dossier affichait « Montant TTC 0.00 » pour un bon de commande dont le montant
 * réel, ouvert directement via `/documents-vente/{id}`, était correct).
 *
 * CAUSE RACINE : `document_vente.total_ttc_centimes` n'est FIGÉ QU'À L'ÉMISSION (`MD-45`,
 * `facturation/documents/service-emission.ts`) — jamais avant. Un document `brouillon` porte donc la
 * valeur PAR DÉFAUT de la colonne (`0`, `db/schema/facturation/document-vente.ts:115`), la remise
 * globale n'étant ventilée qu'à l'émission (`MD-59`/`MD-61`). Un bon de commande reste `brouillon`
 * jusqu'à sa transformation en facture — c'est le cas exact qui déclenchait le bug. `versDocumentVenteResume`
 * lisait cette colonne stockée directement pour TOUS les statuts, sur la foi d'un commentaire erroné
 * (« maintenus par trigger » — il n'existe aucun trigger : la colonne n'est écrite QU'UNE FOIS, par
 * `service-emission.ts`).
 *
 * Reprend EXACTEMENT la doctrine de `facturation/documents/service-documents.ts::assemblerDocument`
 * (dont `calculerTotauxDocument`, fonction PURE sans accès base, est importée ici en LECTURE) : un
 * `brouillon` recalcule EN DIRECT depuis ses lignes stockées (`ligne_document.{ht,tva,ttc}_centimes`,
 * déjà persistées ligne par ligne — cette fonction ne recalcule RIEN au niveau ligne, elle ne fait
 * que les SOMMER, comme `calculerTotauxDocument` le fait déjà côté facturation), un document émis
 * (et au-delà) lit tel quel `document_vente.total_ttc_centimes`.
 *
 * Une seule requête `lignes` batchée pour tous les documents `brouillon` du lot (jamais une par
 * document) — même souci de performance que `listerFinancementsDossier`/`listerDocumentsRequis`
 * voisins.
 */
export interface LigneDocumentPourTotal {
  readonly documentId: string;
  readonly htCentimes: number;
  readonly tvaCentimes: number;
  readonly ttcCentimes: number;
}

/**
 * Partie PURE de `totauxTtcAffichesDocumentsDossier` (aucun accès `tx`) — séparée pour rester
 * testable sans mocker la chaîne `drizzle`, même patron que `calcul-document.ts` côté facturation
 * (`calculerTotauxDocument` : pur, l'appelant fait les requêtes). `lignesBrouillon` ne contient QUE
 * les lignes des documents `brouillon` de `documents` — un document émis n'a pas besoin de ses
 * lignes ici, sa colonne stockée suffit (voir la docstring ci-dessous).
 */
export function repartirTotalTtcAfficheParDocument(
  documents: readonly LigneDocumentVente[],
  lignesBrouillon: readonly LigneDocumentPourTotal[],
): ReadonlyMap<string, number> {
  const parDocument = new Map<string, LigneDocumentPourTotal[]>();
  for (const l of lignesBrouillon) {
    const liste = parDocument.get(l.documentId) ?? [];
    liste.push(l);
    parDocument.set(l.documentId, liste);
  }
  const resultat = new Map<string, number>();
  for (const doc of documents) {
    resultat.set(
      doc.id,
      doc.statut === 'brouillon'
        ? calculerTotauxDocument(parDocument.get(doc.id) ?? []).totalTtcCentimes
        : Number(doc.totalTtcCentimes),
    );
  }
  return resultat;
}

export async function totauxTtcAffichesDocumentsDossier(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  documents: readonly LigneDocumentVente[],
): Promise<ReadonlyMap<string, number>> {
  const brouillonIds = documents.filter((d) => d.statut === 'brouillon').map((d) => d.id);
  if (brouillonIds.length === 0) return repartirTotalTtcAfficheParDocument(documents, []);

  const lignesBrouillon = await tx
    .select({
      documentId: ligneDocument.documentId,
      htCentimes: ligneDocument.htCentimes,
      tvaCentimes: ligneDocument.tvaCentimes,
      ttcCentimes: ligneDocument.ttcCentimes,
    })
    .from(ligneDocument)
    .where(
      and(
        eq(ligneDocument.tenantId, ctx.tenantId),
        inArray(ligneDocument.documentId, brouillonIds),
      ),
    );

  return repartirTotalTtcAfficheParDocument(documents, lignesBrouillon);
}
