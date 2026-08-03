import { and, desc, eq } from 'drizzle-orm';

import type { ContexteTenant, TransactionDfa } from '../db';
import {
  documentVente,
  dossierVente,
  dossierVenteDocumentRequis,
  financementVente,
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

export async function chargerVehiculeStock(tx: TransactionDfa, ctx: ContexteTenant, vehiculeId: string): Promise<LigneVehiculeStock> {
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
  const condition = and(eq(dossierVente.tenantId, ctx.tenantId), eq(dossierVente.id, dossierVenteId));
  const [ligne] = pourEcriture
    ? await tx.select().from(dossierVente).where(condition).limit(1).for('update')
    : await tx.select().from(dossierVente).where(condition).limit(1);
  return ligne ?? null;
}

export async function chargerDossierVente(tx: TransactionDfa, ctx: ContexteTenant, dossierVenteId: string): Promise<LigneDossierVente> {
  const ligne = await chargerDossierVenteOuNull(tx, ctx, dossierVenteId, false);
  if (!ligne) {
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Dossier de vente ${dossierVenteId} introuvable.`);
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
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Dossier de vente ${dossierVenteId} introuvable.`);
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
  const condition = and(eq(reprise.tenantId, ctx.tenantId), eq(reprise.dossierVenteId, dossierVenteId));
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
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Aucune reprise pour le dossier de vente ${dossierVenteId}.`);
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
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Aucune reprise pour le dossier de vente ${dossierVenteId}.`);
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
    .where(and(eq(financementVente.tenantId, ctx.tenantId), eq(financementVente.dossierVenteId, dossierVenteId)))
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
    throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Financement ${financementId} introuvable pour ce dossier de vente.`);
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
    .where(and(eq(dossierVenteDocumentRequis.tenantId, ctx.tenantId), eq(dossierVenteDocumentRequis.dossierVenteId, dossierVenteId)))
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
    .where(and(eq(documentVente.tenantId, ctx.tenantId), eq(documentVente.dossierVenteId, dossierVenteId)))
    .orderBy(desc(documentVente.dateDocument))
    .limit(SEUIL_DOCUMENTS_DOSSIER + 1);
}
