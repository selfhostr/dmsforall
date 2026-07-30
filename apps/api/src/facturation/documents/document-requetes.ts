import { and, asc, eq } from 'drizzle-orm';

import type { ContexteTenant, TransactionDfa } from '../../db';
import { documentVente, documentVenteTva, ligneDocument, parametreAtelier, type LigneDocumentVente, type LigneDocumentVenteTva, type LigneLigneDocument } from '../../db/schema';
import { ErreurMetier } from '../../common/erreurs/erreur-metier';

/**
 * Lectures/verrous PARTAGÉS par les services `facturation/documents`. Rescoping explicite sur
 * `tenant_id` en plus du RLS (le RLS est le filet, jamais le mécanisme — doctrine du projet), même
 * patron que `atelier/or-requetes.ts`.
 */

export async function chargerDocumentOuNull(
  tx: TransactionDfa,
  ctx: ContexteTenant,
  documentId: string,
  pourEcriture = false,
): Promise<LigneDocumentVente | null> {
  const condition = and(eq(documentVente.tenantId, ctx.tenantId), eq(documentVente.id, documentId));
  const [ligne] = pourEcriture
    ? await tx.select().from(documentVente).where(condition).limit(1).for('update')
    : await tx.select().from(documentVente).where(condition).limit(1);
  return ligne ?? null;
}

export async function chargerDocument(tx: TransactionDfa, ctx: ContexteTenant, documentId: string): Promise<LigneDocumentVente> {
  const ligne = await chargerDocumentOuNull(tx, ctx, documentId, false);
  if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Document de vente ${documentId} introuvable.`);
  return ligne;
}

/** Verrouille et rend le document, ou lève `RESSOURCE_INTROUVABLE` — point d'entrée de TOUTE
 *  écriture (création de ligne, émission, transition). */
export async function chargerDocumentPourEcriture(tx: TransactionDfa, ctx: ContexteTenant, documentId: string): Promise<LigneDocumentVente> {
  const ligne = await chargerDocumentOuNull(tx, ctx, documentId, true);
  if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Document de vente ${documentId} introuvable.`);
  return ligne;
}

export async function listerLignesDocument(tx: TransactionDfa, ctx: ContexteTenant, documentId: string): Promise<readonly LigneLigneDocument[]> {
  return tx
    .select()
    .from(ligneDocument)
    .where(and(eq(ligneDocument.tenantId, ctx.tenantId), eq(ligneDocument.documentId, documentId)))
    .orderBy(asc(ligneDocument.numeroOrdre));
}

/** Verrouille toutes les lignes du document (utilisé à l'émission : la ventilation de la remise
 *  globale et l'agrégation TVA doivent voir un état stable). */
export async function listerLignesDocumentPourEcriture(tx: TransactionDfa, ctx: ContexteTenant, documentId: string): Promise<readonly LigneLigneDocument[]> {
  return tx
    .select()
    .from(ligneDocument)
    .where(and(eq(ligneDocument.tenantId, ctx.tenantId), eq(ligneDocument.documentId, documentId)))
    .orderBy(asc(ligneDocument.numeroOrdre))
    .for('update');
}

export async function chargerLigneOuNull(tx: TransactionDfa, ctx: ContexteTenant, documentId: string, ligneId: string): Promise<LigneLigneDocument | null> {
  const [ligne] = await tx
    .select()
    .from(ligneDocument)
    .where(and(eq(ligneDocument.tenantId, ctx.tenantId), eq(ligneDocument.documentId, documentId), eq(ligneDocument.id, ligneId)));
  return ligne ?? null;
}

export async function chargerLignePourEcriture(tx: TransactionDfa, ctx: ContexteTenant, documentId: string, ligneId: string): Promise<LigneLigneDocument> {
  const [ligne] = await tx
    .select()
    .from(ligneDocument)
    .where(and(eq(ligneDocument.tenantId, ctx.tenantId), eq(ligneDocument.documentId, documentId), eq(ligneDocument.id, ligneId)))
    .for('update');
  if (!ligne) throw new ErreurMetier('RESSOURCE_INTROUVABLE', `Ligne ${ligneId} introuvable sur le document ${documentId}.`);
  return ligne;
}

export async function listerVentilationTva(tx: TransactionDfa, ctx: ContexteTenant, documentId: string): Promise<readonly LigneDocumentVenteTva[]> {
  return tx.select().from(documentVenteTva).where(and(eq(documentVenteTva.tenantId, ctx.tenantId), eq(documentVenteTva.documentId, documentId)));
}

/** `RF-117` (migration 0018) : plafond d'émission d'avoir pour `receptionnaire` seul, en centimes.
 *  `NULL` = aucun plafond convenu pour ce tenant — sémantique posée par la migration, jamais
 *  réinterprétée ici. Une ligne par tenant (`parametre_atelier`, PK = `tenant_id`) : absence de
 *  ligne (tenant jamais paramétré) traitée comme `NULL`, même comportement. */
export async function chargerPlafondAvoirReceptionnaire(tx: TransactionDfa, ctx: ContexteTenant): Promise<number | null> {
  const [ligne] = await tx
    .select({ plafondCentimes: parametreAtelier.plafondAvoirReceptionnaireCentimes })
    .from(parametreAtelier)
    .where(eq(parametreAtelier.tenantId, ctx.tenantId))
    .limit(1);
  return ligne?.plafondCentimes ?? null;
}

/** `RF-117` : Σ des montants TTC (valeur absolue) des avoirs déjà ÉMIS (`statut = 'emis'`) qui
 *  créditent `factureAnnuleeId` — un avoir encore en `brouillon` n'est pas opposable (`RF-9`, peut
 *  être abandonné) et n'entre pas dans la somme. Un avoir porte un `total_ttc_centimes <= 0` par
 *  construction (migration 0010 §9) ; `abs()` rend le montant réellement crédité au client, même
 *  convention que le trigger `imputation_paiement_verifier_invariants` (MD-51). */
export async function sommerAvoirsEmisPourFacture(tx: TransactionDfa, ctx: ContexteTenant, factureAnnuleeId: string): Promise<number> {
  const lignes = await tx
    .select({ totalTtcCentimes: documentVente.totalTtcCentimes })
    .from(documentVente)
    .where(
      and(
        eq(documentVente.tenantId, ctx.tenantId),
        eq(documentVente.typeDocument, 'avoir'),
        eq(documentVente.factureAnnuleeId, factureAnnuleeId),
        eq(documentVente.statut, 'emis'),
      ),
    );
  return lignes.reduce((somme, l) => somme + Math.abs(Number(l.totalTtcCentimes)), 0);
}
